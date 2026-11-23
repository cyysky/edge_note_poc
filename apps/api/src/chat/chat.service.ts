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
import type {
  ChatDerivation,
  ChatRequest,
  ChatResponse,
  ChatToolTrace,
  ChatTurn,
  DescribeResponse,
} from '@displayer/shared';

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

  /**
   * Caption one image or transcribe one clip.
   *
   * A separate model call, on purpose: it runs when the file is attached, so
   * the person can see and correct what the model believes the file contains
   * before it becomes part of the conversation.
   */
  async describe(
    media: { readonly mimeType: string; readonly data: string },
    kind: 'image' | 'audio',
  ): Promise<DescribeResponse> {
    try {
      const text = await this.client.describe(media, kind);
      return { text };
    } catch (error) {
      if (error instanceof ModelError && error.kind === 'unreachable') {
        this.logger.error('The local model server is not answering.');
        throw new ModelUnavailableError();
      }
      throw error;
    }
  }

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

/**
 * The bytes go to the model, and so does what they say.
 *
 * Captions and transcripts reach the UI before the turn is sent, which means
 * the text can be about content the model is no longer given; keeping both the
 * arrangement explicit is what lets a person see exactly what was understood.
 */
export function toUserMessage(turn: ChatTurn): UserMessage {
  const parts: UserContentPart[] = [];
  if (turn.text.trim().length > 0) parts.push({ type: 'text', text: turn.text });
  for (const [index, image] of (turn.images ?? []).entries()) {
    parts.push({ type: 'image', mimeType: image.mimeType, data: image.data });
    const caption = turn.derived?.[index];
    if (caption) parts.push({ type: 'text', text: 'Image ' + (index + 1) + ': ' + caption.text });
  }
  const imageCount = turn.images?.length ?? 0;
  for (const [index, audio] of (turn.audio ?? []).entries()) {
    parts.push({ type: 'audio', mimeType: audio.mimeType, data: audio.data });
    const transcript = turn.derived?.[imageCount + index];
    if (transcript) {
      parts.push({ type: 'text', text: 'Audio ' + (index + 1) + ': ' + transcript.text });
    }
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
export function toHistoryMessage(turn: ChatTurn): Message {
  if (turn.role === 'assistant') return { role: 'assistant', content: turn.text };
  return { role: 'user', content: withDerivations(turn.text, turn.derived) };
}

/** What an earlier attachment said, replayed as text now that its bytes are gone. */
function withDerivations(text: string, derived: readonly ChatDerivation[] | undefined): string {
  const lines = (derived ?? []).map((entry) => '- ' + entry.text);
  if (lines.length === 0) return text;
  const summary = 'Attachments in this message:\n' + lines.join('\n');
  return text.trim().length > 0 ? text + '\n\n' + summary : summary;
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
