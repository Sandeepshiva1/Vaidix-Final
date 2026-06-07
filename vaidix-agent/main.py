"""
Vaidix Captions Agent — LiveKit Agent (hidden) per LIVE room.

Joins every LiveKit room as a hidden participant (invisible to viewers and
unlisted in the participant strip — LiveKit's `agent` participant kind is
hidden by default). Subscribes to every published audio track, runs
Deepgram streaming STT per track, and POSTs finalized + partial utterances
to the Vaidix Next.js API endpoint:

    POST {VAIDIX_INGEST_URL}/api/classroom/sessions/<id>/live-captions/ingest
    Authorization: Bearer <LIVE_CAPTIONS_INGEST_SECRET>

The LiveKit room name is `session-<sessionId>` (see vaidix/src/lib/livekit.ts
`sessionRoomName`); the agent strips the `session-` prefix to get the Vaidix
TeachingSession.id.

Cost model: one Deepgram WebSocket per *unmuted* participant for the
duration they speak. When the room has 100 viewers and 2 speakers, this
agent process opens 2 Deepgram streams — not 100. All viewers see the
captions through the existing /live-captions SSE fan-out for free.

Speaker attribution comes from the LiveKit participant identity / name
attached to each subscribed track — no diarization heuristics required.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx
from livekit import rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    stt,
)
from livekit.plugins import deepgram

logger = logging.getLogger("vaidix-captions-agent")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

# ─── Required env ─────────────────────────────────────────────────────────
# LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are read by livekit-agents
# automatically. The three below are ours. We validate them explicitly and
# fail fast with an actionable message: docker-compose passes an *unset* var as
# an empty string (not absent), so a bare `os.environ["X"]` would hand us "" and
# the agent would then run forever producing no captions — the exact silent
# failure that makes the live transcript sit on "Waiting for captions…". Crash
# loudly instead, so the misconfiguration is obvious in `docker logs`.
def _require_env(name: str, hint: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        logger.error(
            "FATAL: %s is not set. %s Captions cannot run without it. Set it in "
            "the deployment .env and recreate this service:\n"
            "  docker compose -f docker-compose.prod.yml --env-file .env "
            "up -d --force-recreate vaidix-captions-agent",
            name, hint,
        )
        raise SystemExit(1)
    return val


INGEST_URL = _require_env(
    "VAIDIX_INGEST_URL",
    "It is the internal URL of the Next.js app (e.g. http://app:3000).",
).rstrip("/")
INGEST_SECRET = _require_env(
    "LIVE_CAPTIONS_INGEST_SECRET",
    "It is the 32+ char secret shared with the app's env of the same name.",
)
DEEPGRAM_API_KEY = _require_env(
    "DEEPGRAM_API_KEY",
    "It is the Deepgram speech-to-text API key (get one at "
    "https://console.deepgram.com).",
)
DEEPGRAM_MODEL = os.environ.get("DEEPGRAM_MODEL", "nova-3")
LANGUAGE = os.environ.get("VAIDIX_CAPTIONS_LANG", "en")

_http_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=10.0)
    return _http_client


async def _post_ingest(session_id: str, payload: dict) -> None:
    """Best-effort POST. Dropped segments degrade the overlay only."""
    url = f"{INGEST_URL}/api/classroom/sessions/{session_id}/live-captions/ingest"
    headers = {
        "Authorization": f"Bearer {INGEST_SECRET}",
        "Content-Type": "application/json",
    }
    try:
        resp = await _http().post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.warning(
                "ingest %s returned %s: %s",
                url, resp.status_code, resp.text[:200],
            )
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("ingest POST failed: %s", exc)


async def _run_track_stt(
    session_id: str,
    participant: rtc.RemoteParticipant,
    track: rtc.RemoteAudioTrack,
) -> None:
    """
    One Deepgram streaming STT for this track. Forward interim + final
    transcripts to /live-captions/ingest tagged with the speaker's display
    name + LiveKit identity.
    """
    # endpointing=100ms: Deepgram finalises an utterance after 100ms of silence
    # instead of the ~300ms default. Cuts FINAL_TRANSCRIPT latency by ~200ms.
    # smart_format removed: it buffers the full utterance to reformat numbers
    # and punctuation, adding latency with no benefit for a live overlay.
    dg = deepgram.STT(
        api_key=DEEPGRAM_API_KEY,
        model=DEEPGRAM_MODEL,
        language=LANGUAGE,
        interim_results=True,
        punctuate=True,
        endpointing=100,
    )

    audio_stream = rtc.AudioStream(track)
    stt_stream = dg.stream()

    track_start = time.monotonic()
    speaker_name = participant.name or participant.identity
    speaker_identity = participant.identity

    def _segment_ms(alt: object) -> tuple[int, int]:
        """Return (startMs, endMs) using Deepgram's word-level timing when
        available, falling back to wall-clock if not.  Deepgram sets
        end_time=0 when no words were detected (silence frame), so we only
        trust it when end_time > 0."""
        end_sec: float = getattr(alt, "end_time", 0.0) or 0.0
        start_sec: float = getattr(alt, "start_time", 0.0) or 0.0
        if end_sec > 0:
            start_ms = int(start_sec * 1000)
            end_ms = max(int(end_sec * 1000), start_ms + 50)
            return start_ms, end_ms
        # Fallback: approximate from wall clock and word count.
        text = getattr(alt, "text", "") or ""
        now_ms = int((time.monotonic() - track_start) * 1000)
        word_count = max(1, len(text.split()))
        start_ms = max(0, now_ms - word_count * 380)  # ~158 wpm
        return start_ms, now_ms

    async def _pump_audio() -> None:
        try:
            async for ev in audio_stream:
                stt_stream.push_frame(ev.frame)
        finally:
            stt_stream.end_input()

    async def _drain_events() -> None:
        # Throttle partial (INTERIM) POSTs: Deepgram fires them on every
        # decoded frame (~20ms), so posting every one would generate ~50
        # HTTP calls/sec per speaker and saturate the ingest endpoint.
        # One partial per 300ms is plenty for a smooth overlay.
        last_partial_post: float = 0.0
        PARTIAL_THROTTLE_S = 0.3

        try:
            async for ev in stt_stream:
                if ev.type == stt.SpeechEventType.INTERIM_TRANSCRIPT:
                    now = time.monotonic()
                    if now - last_partial_post < PARTIAL_THROTTLE_S:
                        continue
                    last_partial_post = now
                    text = ev.alternatives[0].text.strip() if ev.alternatives else ""
                    if not text:
                        continue
                    start_ms, end_ms = _segment_ms(ev.alternatives[0])
                    await _post_ingest(session_id, {
                        "segments": [{
                            "startMs": start_ms,
                            "endMs": end_ms,
                            "text": text[:5000],
                            "lang": LANGUAGE,
                            "speaker": speaker_name,
                            "speakerIdentity": speaker_identity,
                            "partial": True,
                        }],
                    })
                elif ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                    alt = ev.alternatives[0] if ev.alternatives else None
                    if alt is None:
                        continue
                    text = alt.text.strip()
                    if not text:
                        continue
                    start_ms, end_ms = _segment_ms(alt)
                    await _post_ingest(session_id, {
                        "segments": [{
                            "startMs": start_ms,
                            "endMs": end_ms,
                            "text": text[:5000],
                            "lang": LANGUAGE,
                            "speaker": speaker_name,
                            "speakerIdentity": speaker_identity,
                            "confidence": getattr(alt, "confidence", None),
                            "partial": False,
                        }],
                    })
        except Exception as exc:  # noqa: BLE001
            logger.warning("STT drain ended for %s: %s", speaker_identity, exc)

    logger.info(
        "STT online for participant=%s identity=%s session=%s",
        speaker_name, speaker_identity, session_id,
    )
    try:
        await asyncio.gather(_pump_audio(), _drain_events())
    finally:
        try:
            await stt_stream.aclose()
        except Exception:  # noqa: BLE001
            pass
        logger.info("STT offline for participant=%s", speaker_identity)


async def entrypoint(ctx: JobContext) -> None:
    """
    Auto-dispatched by LiveKit when a room is created. Connect audio-only
    (saves bandwidth — we never need video), spawn one STT pump per
    audio publication, finalize the transcript on shutdown.
    """
    room_name = ctx.room.name
    if not room_name.startswith("session-"):
        logger.info("ignoring non-session room: %s", room_name)
        return
    session_id = room_name[len("session-"):]
    logger.info("captions agent attaching session=%s", session_id)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    tasks: dict[str, asyncio.Task] = {}

    def _on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        if not isinstance(track, rtc.RemoteAudioTrack):
            return
        key = f"{participant.identity}:{publication.sid}"
        existing = tasks.get(key)
        if existing is not None and not existing.done():
            return
        tasks[key] = asyncio.create_task(
            _run_track_stt(session_id, participant, track),
            name=f"stt:{participant.identity}",
        )

    ctx.room.on("track_subscribed", _on_track_subscribed)

    finalized = asyncio.Event()

    async def _finalize() -> None:
        if finalized.is_set():
            return
        finalized.set()
        for t in list(tasks.values()):
            t.cancel()
        await _post_ingest(session_id, {
            "segments": [],
            "finalizeOnEnd": True,
        })
        logger.info("finalize sent session=%s", session_id)

    ctx.add_shutdown_callback(_finalize)

    disconnected = asyncio.Event()
    ctx.room.on("disconnected", lambda *_: disconnected.set())
    await disconnected.wait()
    await _finalize()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
