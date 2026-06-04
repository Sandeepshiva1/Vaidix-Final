// ════════════════════════════════════════════════════════════════════════════
// LiveKit helpers — shared utility for distinguishing agent participants from
// human participants in our LiveKit-backed teaching rooms.
// ════════════════════════════════════════════════════════════════════════════
//
// Why this exists: our captions-agent (vaidix-agent/) runs on
// livekit-agents==0.12.x, which is older than the 1.0+ release that introduced
// the `kind: AGENT` participant-info flag. So the agent joins the room with
// `kind: STANDARD` (the default) and the obvious filter
// `p.kind !== ParticipantKind.AGENT` never matches — the agent kept showing
// up as a giant placeholder tile in the video grid and a row in the People
// panel for both hosts and guests (Feeddback.md observed via screenshots
// 2026-05-17).
//
// The framework still assigns agent identities a stable prefix though:
// `agent-AJ_<token>`. So we belt-and-suspenders the filter — match on EITHER
// the AGENT kind (works once we upgrade to 1.0+) OR the identity prefix
// (works today on 0.12.x). When we eventually upgrade livekit-agents, the
// kind check will start firing too and this helper keeps working unchanged.

import { ParticipantKind } from 'livekit-client'

/// Shape we accept — matches both the `Participant` SDK object (which has
/// `kind` and `identity`) and the `TrackReference.participant` value we get
/// out of `useTracks()`. Typed loosely so a future SDK rename of `kind` to
/// something else doesn't ripple through every call site.
type AgentLike = {
  identity: string
  kind?: ParticipantKind | number
}

/// True for the captions agent and any other agent-framework participant.
/// Use this to filter out agents from participant lists / video grids.
/// Keep the OR — see file header for the 0.12 vs 1.0 framework rationale.
export function isAgentParticipant(p: AgentLike): boolean {
  if (p.kind === ParticipantKind.AGENT) return true
  return p.identity.startsWith('agent-')
}
