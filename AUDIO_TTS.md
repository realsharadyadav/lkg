# Shared audio generation

For any new LKG narration or text-to-audio work, use the separate shared Kokoro service at `/Users/sharad/dev/kokoro-fastapi` instead of adding a TTS model to this project. Start it with `./start-gpu_mac.sh`, then use the local Web UI at `http://localhost:8880/web` or the OpenAI-compatible API at `http://localhost:8880/v1` (Adam voice: `am_adam`).
