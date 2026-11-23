/**
 * Conversation model for the local agent.
 *
 * The shape mirrors the OpenAI chat-completions wire format because that is
 * what llama-server speaks, but it is narrowed to the parts LFM3-Omni actually
 * produces: text, tool calls, and multimodal user content.
 */

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

/** Base64 media carried inline; llama-server accepts these without a file path. */
export interface ImagePart {
  readonly type: 'image';
  readonly mimeType: string;
  readonly data: string;
}

export interface AudioPart {
  readonly type: 'audio';
  readonly mimeType: string;
  readonly data: string;
}

export interface VideoPart {
  readonly type: 'video';
  readonly mimeType: string;
  readonly data: string;
}

export type UserContentPart = TextPart | ImagePart | AudioPart | VideoPart;

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw JSON text exactly as the model emitted it, before validation. */
  readonly arguments: string;
}

export interface SystemMessage {
  readonly role: 'system';
  readonly content: string;
}

export interface UserMessage {
  readonly role: 'user';
  readonly content: string | readonly UserContentPart[];
}

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** True when a user message carries any non-text part. */
export function hasMedia(message: UserMessage): boolean {
  return (
    typeof message.content !== 'string' && message.content.some((part) => part.type !== 'text')
  );
}

/** Flattened text of a user message, for logging, retrieval and TTS. */
export function textOf(message: UserMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}
