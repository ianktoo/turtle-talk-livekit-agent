/**
 * Turtle Talk LiveKit voice agent.
 * Uses OpenAI Realtime API for speech-in and speech-out.
 * Run: pnpm dev (connects to LiveKit Cloud), or deploy with lk agent create.
 */
import { type JobContext, ServerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { ShellyAgent } from './agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// #region agent log
const DEBUG_LOG_PATH = join(__dirname, '..', 'debug-6febbf.log');
function debugLog(location: string, message: string, data: Record<string, unknown>, hypothesisId?: string, runId?: string): void {
  try { appendFileSync(DEBUG_LOG_PATH, JSON.stringify({ sessionId: '6febbf', location, message, data, timestamp: Date.now(), hypothesisId, runId }) + '\n'); } catch {}
}
// #endregion

// Workaround for a race condition in @livekit/agents-plugin-openai@1.0.48:
// When a participant disconnects while OpenAI is still streaming a response,
// handleResponseOutputItemAdded throws "currentGeneration is not set" because
// the session teardown clears it before the WebSocket delivers remaining events.
// This unhandled exception crashes the child process and permanently breaks the
// worker's proc pool (all subsequent jobs get ERR_IPC_CHANNEL_CLOSED).
const KNOWN_RACE_ERRORS = ['currentGeneration is not set', 'item.type is not set'];
process.on('uncaughtException', (err) => {
  // #region agent log
  debugLog('main.ts:uncaughtException', 'uncaught exception intercepted', { message: err.message, stack: err.stack }, 'FIX', 'post-fix');
  // #endregion
  if (KNOWN_RACE_ERRORS.some((msg) => err.message === msg)) {
    console.warn('[shelly] suppressed known OpenAI Realtime race condition:', err.message);
    return;
  }
  console.error('[shelly] fatal uncaught exception:', err);
  process.exit(1);
});

function sendTranscript(room: { localParticipant?: { publishData(data: Uint8Array, opts: { reliable?: boolean }): Promise<void> } }, role: 'user' | 'assistant', text: string): void {
  const payload = new TextEncoder().encode(JSON.stringify({ type: 'transcript', role, text }));
  room.localParticipant?.publishData(payload, { reliable: true }).catch(() => {});
}

/** Parse dispatch metadata from the job (childName, topics). Works on LiveKit Cloud; may be empty on self-hosted. */
function parseDispatchMetadata(ctx: JobContext): { childName?: string; topics?: string[] } {
  const raw = (ctx.job as { metadata?: string })?.metadata;
  if (!raw || typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as { childName?: string | null; topics?: string[] };
    const childName =
      typeof parsed.childName === 'string' && parsed.childName.trim()
        ? parsed.childName.trim()
        : undefined;
    const topics = Array.isArray(parsed.topics)
      ? (parsed.topics as string[]).filter((t): t is string => typeof t === 'string')
      : undefined;
    return { childName, topics };
  } catch {
    return {};
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const { childName, topics } = parseDispatchMetadata(ctx);

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        voice: 'coral',
      }),
    });

    await session.start({
      agent: new ShellyAgent({ childName, topics }),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    await ctx.connect();

    const room = ctx.room;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal && ev.transcript.trim()) {
        sendTranscript(room, 'user', ev.transcript);
      }
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item.role === 'assistant') {
        const text = (ev.item as { textContent?: string }).textContent;
        if (text?.trim()) {
          sendTranscript(room, 'assistant', text);
        }
      }
    });

    const firstMessageInstruction = childName
      ? `Greet ${childName} warmly and ask how they are or what they did today. One sentence and one question.`
      : 'Greet the child warmly and ask how they are or what they did today. One sentence and one question.';
    const handle = session.generateReply({
      instructions: firstMessageInstruction,
    });
    await handle?.waitForPlayout?.();
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'shelly',
    // Give the job process more time to start (default 10s can be too short on Windows / cold start for 2nd+ jobs)
    initializeProcessTimeout: 60 * 1000,
  })
);
