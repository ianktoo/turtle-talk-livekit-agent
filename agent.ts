import { voice, llm } from '@livekit/agents';
import { BASE_SYSTEM_PROMPT } from '../lib/speech/prompts.js';

/** Shelly — voice agent for children (3rd–6th grade). Used by the LiveKit pipeline. */
export class ShellyAgent extends voice.Agent {
  constructor(options?: { childName?: string; topics?: string[]; tools?: llm.ToolContext }) {
    let instructions = BASE_SYSTEM_PROMPT;

    if (options?.childName) {
      instructions += `\n\nThe child's name is ${options.childName}. Use their name occasionally.`;
    } else {
      instructions += `\n\nYou do not know the child's name yet. Call them a little explorer or similar friendly term until they share their name.`;
    }
    if (options?.topics?.length) {
      instructions += `\n\nThis child has enjoyed talking about: ${options.topics.join(', ')}. Reference naturally if relevant.`;
    }

    super({ instructions, tools: options?.tools });
  }
}
