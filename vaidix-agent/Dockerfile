FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /agent

COPY requirements.txt /agent/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Build-time import smoke. MUST mirror every top-level import in main.py so
# missing transitive deps (PyAV, livekit-plugins-*, etc.) fail THIS build
# instead of crash-looping at runtime after deploy. If you add or change a
# top-level import in main.py, update this line too.
RUN python -c "import av; import httpx; from livekit import rtc; from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, stt; from livekit.plugins import deepgram; print('agent imports OK')"

COPY main.py /agent/main.py

# `start` is the livekit-agents subcommand that runs the worker forever and
# registers it with the LiveKit server for auto-dispatch on every new room.
CMD ["python", "main.py", "start"]
