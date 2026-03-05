# LiveKit voice agent – troubleshooting

This guide follows [LiveKit Agents](https://docs.livekit.io/agents/overview/) and explains why audio might not work and how to fix it.

## How it works (LiveKit flow)

1. **App (Next.js)**  
   User opens `/talk`. The app calls `POST /api/livekit/token` to get a **token** and **LiveKit URL**.

2. **Client joins room**  
   The frontend connects to LiveKit with that token and joins a **room** (e.g. `talk-<timestamp>-<random>` or `talk-<childName>`).

3. **Agent dispatch**  
   When the room is created, **LiveKit Cloud** (or your LiveKit server) sends a **dispatch** to any registered **agent server** that can handle the room. Your agent is registered with **agent name `shelly`**.

4. **Agent joins room**  
   The `livekit-agent` process (running `pnpm dev` or deployed) receives the dispatch, starts a **job**, and **joins the same room**. The agent then runs the voice pipeline (OpenAI Realtime: speech-in → LLM → speech-out) and publishes audio back to the room.

5. **User hears Shelly**  
   The app subscribes to the agent’s audio track and plays it.

If the **agent is not running** or not connected to the same LiveKit project, the user joins an empty room: the mic is sent, but no agent is there to process it or respond. That is the most common reason “audio doesn’t work.”

---

## End-to-end checklist

Use this checklist to verify the full flow after any change:

1. **Env**  
   Next app and agent both use the **same** LiveKit project (same `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). The agent also has `OPENAI_API_KEY` set.

2. **Start services**  
   Start the agent (`livekit-agent`: `pnpm dev` or `npm run dev`), then the app (`npm run dev`). Ensure `NEXT_PUBLIC_VOICE_PROVIDER=livekit` in the app’s `.env.local`.

3. **Open /talk**  
   Allow microphone when prompted, then click **“Talk to Shelly”**.

4. **Verify**  
   - Token is fetched (check Network tab: `POST /api/livekit/token` returns 200 with `token`, `roomName`, `livekitUrl`).  
   - Room connects; state shows “listening” then “speaking” when Shelly replies.  
   - You hear Shelly’s greeting and can speak and get a reply.  
   - Mute/unmute works; End call returns to idle/post-call bar.

---

## Checklist

### 1. Agent is running and connected

The agent must be **running** so it can register with LiveKit and receive dispatches.

From the **repo root** or from **livekit-agent**:

```bash
cd livekit-agent
pnpm install
pnpm dev
```

You should see the agent connect to LiveKit (e.g. “registered worker” or similar). Leave this process running while you use the app.

- **Deployed:** If you use `lk agent create` and deploy to LiveKit Cloud, the agent runs in the cloud and you don’t need a local process. Ensure the same LiveKit project and agent name are used.

### 2. Agent environment variables

The agent loads `.env.local` from the **livekit-agent** directory (or the repo root). It needs:

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | Yes | LiveKit WebSocket URL (e.g. `wss://your-project.livekit.cloud`). Same project as the Next app. |
| `LIVEKIT_API_KEY` | Yes | LiveKit project API key. |
| `LIVEKIT_API_SECRET` | Yes | LiveKit project API secret. |
| `OPENAI_API_KEY` | Yes | OpenAI API key for the Realtime API. |

### 3. Next app environment

The **Next.js** app (token API) needs the **same** LiveKit project:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

These are used in `app/api/livekit/token/route.ts`. The frontend uses `NEXT_PUBLIC_VOICE_PROVIDER=livekit` so the client uses the LiveKit provider and requests a token from `/api/livekit/token`.

### 4. Agent name and dispatch

The agent registers with **agent name `shelly`** (`agentName: 'shelly'` in `main.ts`). LiveKit Cloud dispatches to this agent when a new room is created in the project. No extra configuration is needed if the agent is running and connected.

### 5. Browser

- **Microphone:** The app requests mic permission; if denied, you get the permission screen instead of the talk view.
- **HTTPS:** For production, use HTTPS (or localhost for dev). LiveKit connections work from localhost.

---

## Swapping the speech model

This agent uses **OpenAI Realtime** (one model for speech-in and speech-out). To use a different voice, change the `voice` option in `main.ts` (e.g. `coral`, `sage`, `shimmer`). To use a different model or a discrete STT → LLM → TTS pipeline, see [LiveKit Agents models](https://docs.livekit.io/agents/models/) and the [Voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai-quickstart/).

---

## Language

Shelly is instructed to **always respond in English only** (see `agent.ts`). The Realtime API transcribes user audio; if you need to force a specific language, check the OpenAI Realtime plugin options.

---

## Common issues

| Symptom | Likely cause | Fix |
|--------|----------------|-----|
| “Shelly is listening” but no response when you speak | Agent not running or not connected | Start agent with `pnpm dev` in `livekit-agent` and ensure LIVEKIT_* and OPENAI_API_KEY are set. |
| Console shows `[Shelly] native start` or `native: processing (request to /api/talk)` | App is using the **native** provider, not LiveKit | In the **repo root** `.env.local`, set `NEXT_PUBLIC_VOICE_PROVIDER=livekit`. Restart the Next.js dev server and hard-refresh `/talk`. |
| Token error / 503 from `/api/livekit/token` | Missing or wrong LiveKit env in Next app | Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in `.env.local` (root) and restart the dev server. |
| Agent exits or “API key required” | Missing OPENAI_API_KEY in agent env | Add OPENAI_API_KEY to `livekit-agent/.env.local`. |
| Agent runs but never joins the room | Different LiveKit project or agent not dispatched | Ensure agent and Next app use the same LiveKit project (same URL and keys). Run agent with `pnpm dev` and check logs when you open `/talk`. |
| `Error: runner initialization timed out` (often on 2nd call) | New job process took longer than 10s to start | The agent uses a 30s init timeout in `main.ts` (`initializeProcessTimeout`). If it still times out on slow machines, increase it in `ServerOptions` or ensure no other process is blocking CPU. |

---

## References

- [LiveKit Agents overview](https://docs.livekit.io/agents/overview/)
- [Voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai-quickstart/)
- [Agent server lifecycle](https://docs.livekit.io/agents/server/lifecycle/)
