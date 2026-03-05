# Turtle Talk LiveKit Agent

Uses **OpenAI Realtime API** for full-duplex voice: speech-in and speech-out are handled by one model. No separate STT or TTS pipeline — the realtime model does both.

- **Model**: OpenAI Realtime via `@livekit/agents-plugin-openai` (voice in + voice out).
- **Auth**: `OPENAI_API_KEY` (OpenAI platform).

## Setup

1. **LiveKit Cloud**  
   Create a project at [cloud.livekit.io](https://cloud.livekit.io) and run:
   ```bash
   lk cloud auth
   lk app env -w
   ```
   This writes `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` to `.env.local`.

2. **OpenAI**  
   Get an API key from [OpenAI platform](https://platform.openai.com/api-keys) and add to `.env.local`:
   ```bash
   OPENAI_API_KEY=your_key
   ```

3. **Install and run**
   ```bash
   pnpm install
   pnpm dev              # connect to LiveKit Cloud
   ```

### Make commands (optional)

From this directory you can use `make` for common tasks (handy on Linux/macOS or WSL; on Windows you can override `STOP_CMD` or use npm scripts directly):

| Command       | Description |
|--------------|-------------|
| `make install` | Install dependencies (uses pnpm if available, else npm) |
| `make build`   | Compile TypeScript |
| `make debug`   | Run in dev mode (foreground) — for local debugging |
| `make start`   | Build and run in production (foreground) |
| `make stop`    | Stop the agent (default: `pkill` on Unix; override for systemd/pm2) |

On a deployed server, stop via your process manager, e.g.:

```bash
make stop STOP_CMD="systemctl stop turtle-talk-agent"
make stop STOP_CMD="pm2 stop shelly-agent"
```

### Run with Docker

You can build and run the agent in a container. Pass env vars at runtime (or use an env file).

**Build the image:**

```bash
docker build -t turtle-talk-agent .
```

**Run (pass env from host):**

```bash
docker run --rm \
  -e LIVEKIT_URL \
  -e LIVEKIT_API_KEY \
  -e LIVEKIT_API_SECRET \
  -e OPENAI_API_KEY \
  turtle-talk-agent
```

**Run with an env file (create `.env.prod` with the four variables):**

```bash
docker run --rm --env-file .env.prod turtle-talk-agent
```

The image uses Node 20 and runs `node main.js start`. For a lockfile-based build, ensure `package-lock.json` exists (`npm install` once if needed).

Then use the [LiveKit Playground](https://docs.livekit.io/agents/start/playground/) or the Turtle Talk app with `NEXT_PUBLIC_VOICE_PROVIDER=livekit` and a token from `/api/livekit/token`.

**No audio?** See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) (agent must be running; env vars; LiveKit flow).

## Deploy to LiveKit Cloud

From this directory:

```bash
lk agent create
```

Set `OPENAI_API_KEY` (and optionally `LIVEKIT_*`) in LiveKit Cloud secrets for the agent.
