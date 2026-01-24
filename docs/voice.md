# Voice Transcription

Agent Commander can proxy live audio to Deepgram for transcription.

## Enable

Set `DEEPGRAM_API_KEY` in the control plane environment. If it is not set, the voice WebSocket is disabled.

## WebSocket

`GET /v1/voice/transcribe?token=<jwt>`

The client sends binary audio chunks (opus). The server returns JSON messages:
- `connected`
- `transcript` (text, confidence, isFinal)
- `error`

This keeps your API key server side and off the client.
