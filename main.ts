/**
 * Turtle Talk LiveKit voice agent.
 * Uses OpenAI Realtime API for speech-in and speech-out.
 * Run: pnpm dev (connects to LiveKit Cloud), or deploy with lk agent create.
 */
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import { RoomEvent } from '@livekit/rtc-node';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ShellyAgent } from './agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Workaround for a race condition in @livekit/agents-plugin-openai@1.0.48:
// When a participant disconnects while OpenAI is still streaming a response,
// handleResponseOutputItemAdded throws "currentGeneration is not set" because
// the session teardown clears it before the WebSocket delivers remaining events.
// This unhandled exception crashes the child process and permanently breaks the
// worker's proc pool (all subsequent jobs get ERR_IPC_CHANNEL_CLOSED).
const KNOWN_RACE_ERRORS = ['currentGeneration is not set', 'item.type is not set'];
process.on('uncaughtException', (err) => {
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

// #region monitoring

/** Attach room-level event listeners so participant joins/leaves and connection
 *  state changes are logged to the debug file. */
function monitorRoom(ctx: JobContext): void {
  const room = ctx.room;

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    debugLog('monitor:room', 'participant connected', { identity: participant.identity, sid: participant.sid });
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    debugLog('monitor:room', 'participant disconnected', { identity: participant.identity, sid: participant.sid });
  });

  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    debugLog('monitor:room', 'connection state changed', { state });
  });

  room.on(RoomEvent.Reconnecting, () => {
    debugLog('monitor:room', 'room reconnecting', {});
    console.warn('[shelly] room reconnecting…');
  });

  room.on(RoomEvent.Reconnected, () => {
    debugLog('monitor:room', 'room reconnected', {});
    console.info('[shelly] room reconnected');
  });

  room.on(RoomEvent.Disconnected, () => {
    debugLog('monitor:room', 'room disconnected', {});
    console.warn('[shelly] room disconnected');
  });
}

/** Attach session-level event listeners to monitor agent/user state, metrics,
 *  errors, and session close events. */
function monitorSession(session: voice.AgentSession): void {
  session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
    debugLog('monitor:session', 'agent state changed', { from: ev.oldState, to: ev.newState });
  });

  session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
    debugLog('monitor:session', 'user state changed', { from: ev.oldState, to: ev.newState });
  });

  session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
    debugLog('monitor:session', 'metrics collected', { metrics: ev.metrics as unknown as Record<string, unknown> });
  });

  session.on(voice.AgentSessionEventTypes.Error, (ev) => {
    const err = ev.error instanceof Error ? ev.error : new Error(String(ev.error));
    debugLog('monitor:session', 'session error', { message: err.message, stack: err.stack ?? '' });
    console.error('[shelly] session error:', err.message);
  });

  session.on(voice.AgentSessionEventTypes.Close, (ev) => {
    debugLog('monitor:session', 'session closed', { reason: ev.reason, error: ev.error ? String(ev.error) : null });
    console.info('[shelly] session closed, reason:', ev.reason);
  });
}

// #endregion

export default defineAgent({
  prewarm: (_proc: JobProcess) => {
    // Warm up the OpenAI realtime model connection pool so the first job
    // starts faster. Nothing to pre-load for the realtime model beyond
    // ensuring the plugin package is imported (done at module load time).
    debugLog('main.ts:prewarm', 'worker prewarm called', {});
    console.info('[shelly] worker prewarm complete');
  },

  entry: async (ctx: JobContext) => {
    const { childName, topics } = parseDispatchMetadata(ctx);

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        voice: 'coral',
      }),
    });

    monitorSession(session);

    await session.start({
      agent: new ShellyAgent({ childName, topics }),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    await ctx.connect();
    monitorRoom(ctx);

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
