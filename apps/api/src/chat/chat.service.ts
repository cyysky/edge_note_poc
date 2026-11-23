import { Injectable, Logger } from '@nestjs/common';

import {
  NOTES_SYSTEM_PROMPT,
  ModelClient,
  ModelError,
  createNotesBackend,
  createNotesTools,
  runAgent,
  type AgentEvent,
  type Message,
  type UserContentPart,
  type UserMessage,
} from '@displayer/agent';
import type { ChatRequest, ChatResponse, ChatToolTrace, ChatTurn } from '@displayer/shared';

/**
 * Owns the conversation with the local model.
 *
 * The browser is stateless about the model: it stores the visible transcript and
 * posts it back, and this service replays it. Tool calls are not persisted —
 * only their visible effects (notes) are, which is what a user expects.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly client = new ModelClient({
    ...(process.env['MODEL_BASE_URL'] ? { baseUrl: process.env['MODEL_BASE_URL'] } : {}),
  });

  async reply(request: ChatRequest): Promise<ChatResponse> {
    const apiUrl = process.env['NOTES_API_URL'];
    const tools = createNotesTools(createNotesBackend(apiUrl ? { baseUrl: apiUrl } : {}));

    const history = request.messages.slice(0, -1).map(toHistoryMessage);
    const last = request.messages.at(-1);
    if (!last) throw new ModelError('Chat request had no messages.', 'protocol');

    const traces: ChatToolTrace[] = [];
    const pending = new Map<string, { readonly name: string; readonly arguments: string }>();

    try {
      const result = await runAgent(
        {
          client: this.client,
          tools,
          system: NOTES_SYSTEM_PROMPT,
          maxSteps: 8,
          history,
          onEvent: (event: AgentEvent) => recordToolEvent(event, traces, pending),
        },
        toUserMessage(last),
      );

      return { reply: result.text, tools: traces, stopReason: result.stopReason };
    } catch (error) {
      if (error instanceof ModelError && error.kind === 'unreachable') {
        this.logger.error('The local model server is not answering.');
        throw new ModelUnavailableError();
      }
      throw error;
    }
  }
}

export class ModelUnavailableError extends Error {
  constructor() {
    super('The local LFM3-Omni server is not running. Start it with scripts/serve.ps1.');
    this.name = 'ModelUnavailableError';
  }
}

function toUserMessage(turn: ChatTurn): UserMessage {
  const parts: UserContentPart[] = [];
  if (turn.text.trim().length > 0) parts.push({ type: 'text', text: turn.text });
  for (const image of turn.images ?? []) {
    parts.push({ type: 'image', mimeType: image.mimeType, data: image.data });
  }
  for (const audio of turn.audio ?? []) {
    parts.push({ type: 'audio', mimeType: audio.mimeType, data: audio.data });
  }
  if (parts.length === 1 && parts[0]?.type === 'text') return { role: 'user', content: turn.text };
  return { role: 'user', content: parts };
}

/**
 * Earlier turns are replayed as text only.
 *
 * Re-sending old images and audio would multiply the prompt for no benefit; the
 * assistant's summaries of them are already in the transcript.
 */
function toHistoryMessage(turn: ChatTurn): Message {
  return turn.role === 'assistant'
    ? { role: 'assistant', content: turn.text }
    : { role: 'user', content: turn.text };
}

function recordToolEvent(
  event: AgentEvent,
  traces: ChatToolTrace[],
  pending: Map<string, { readonly name: string; readonly arguments: string }>,
): void {
  if (event.type === 'tool-call') {
    pending.set(event.call.id, { name: event.call.name, arguments: event.call.arguments });
    return;
  }
  if (event.type !== 'tool-result') return;

  const call = pending.get(event.call.id) ?? {
    name: event.call.name,
    arguments: event.call.arguments,
  };
  traces.push({ name: call.name, arguments: call.arguments, ok: event.ok, result: event.preview });
}
