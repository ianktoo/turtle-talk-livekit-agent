/**
 * Turtle Talk LiveKit voice agent.
 * Uses OpenAI Realtime API for speech-in and speech-out.
 * Run: pnpm dev (connects to LiveKit Cloud), or deploy with lk agent create.
 */
import { type JobContext, type JobProcess, ServerOptions, cli, defineAgent, llm, voice } from '@livekit/agents';
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

function sendData(room: { localParticipant?: { publishData(data: Uint8Array, opts: { reliable?: boolean }): Promise<void> } }, payload: unknown): void {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  room.localParticipant?.publishData(data, { reliable: true }).catch(() => {});
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
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
  });

  room.on(RoomEvent.ConnectionStateChanged, (state) => {
  });

  room.on(RoomEvent.Reconnecting, () => {
    console.warn('[shelly] room reconnecting…');
  });

  room.on(RoomEvent.Reconnected, () => {
    console.info('[shelly] room reconnected');
  });

  room.on(RoomEvent.Disconnected, () => {
    console.warn('[shelly] room disconnected');
  });
}

/** Attach session-level event listeners to monitor agent/user state, metrics,
 *  errors, and session close events. */
function monitorSession(session: voice.AgentSession): void {
  session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
  });

  session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
  });

  session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
  });

  session.on(voice.AgentSessionEventTypes.Error, (ev) => {
    const err = ev.error instanceof Error ? ev.error : new Error(String(ev.error));
    console.error('[shelly] session error:', err.message);
  });

  session.on(voice.AgentSessionEventTypes.Close, (ev) => {
    console.info('[shelly] session closed, reason:', ev.reason);
  });
}

// #endregion

export default defineAgent({
  prewarm: (_proc: JobProcess) => {
    // Warm up the OpenAI realtime model connection pool so the first job
    // starts faster. Nothing to pre-load for the realtime model beyond
    // ensuring the plugin package is imported (done at module load time).
    console.info('[shelly] worker prewarm complete');
  },

  entry: async (ctx: JobContext) => {
    console.info('[shelly] job received', { room: ctx.job.room?.name, jobId: ctx.job.id });
    try {
      const { childName, topics } = parseDispatchMetadata(ctx);

    const room = ctx.room;

    const proposeMissionsTool = llm.tool({
      description: 'Propose exactly 3 age-appropriate missions/challenges for the child based on what they talked about. Call this before ending every conversation.',
      parameters: {
        type: 'object' as const,
        properties: {
          choices: {
            type: 'array',
            description: 'Exactly 3 mission choices',
            minItems: 3,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short mission title (5 words max)' },
                description: { type: 'string', description: 'What the child will do (1 sentence)' },
                difficulty: { type: 'string', enum: ['easy', 'medium', 'stretch'], description: 'easy=anyone can do it, medium=a little challenge, stretch=big challenge' },
              },
              required: ['title', 'description', 'difficulty'],
            },
          },
        },
        required: ['choices'],
      },
      execute: async (args: { choices: Array<{ title: string; description: string; difficulty: string }> }) => {
        sendData(room, { type: 'missionChoices', choices: args.choices });
        return 'Missions proposed successfully.';
      },
    });

    const endConversationTool = llm.tool({
      description: 'End the conversation after you have said goodbye. Only call this after propose_missions.',
      parameters: { type: 'object' as const, properties: {} },
      execute: async () => {
        sendData(room, { type: 'endConversation' });
        setTimeout(() => { room.disconnect(); }, 3000);
        return 'Conversation ended.';
      },
    });

    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        voice: 'coral',
      }),
    });

      monitorSession(session);

    await session.start({
      agent: new ShellyAgent({ childName, topics, tools: { propose_missions: proposeMissionsTool, end_conversation: endConversationTool } }),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

      await ctx.connect();
      console.info('[shelly] room connected', { room: ctx.room.name });
      monitorRoom(ctx);

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
      console.info('[shelly] generating first reply', { childName: childName ?? '(none)' });
      const handle = session.generateReply({
        instructions: firstMessageInstruction,
      });
      await handle?.waitForPlayout?.();
      console.info('[shelly] first reply playout complete');
    } catch (err) {
      console.error('[shelly] entry failed', err);
      throw err;
    }
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'shelly',
    port: 8080,
    // Give the job process more time to start (default 10s can be too short on Windows / cold start for 2nd+ jobs)
    initializeProcessTimeout: 60 * 1000,
  })
);
