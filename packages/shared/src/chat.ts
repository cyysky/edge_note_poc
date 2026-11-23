/**
 * Chat wire contract.
 *
 * The conversation is stateless on the server: the browser owns the transcript
 * and sends it back each turn. That keeps the API a pure function of its input,
 * so a reload or a second tab cannot corrupt someone's running conversation.
 */

export const CHAT_MESSAGE_MAX = 20_000;
/** Turns kept in a replayed transcript. */
export const CHAT_MAX_HISTORY = 40;
/**
 * Per-file ceiling. The browser reads attachments into memory as base64, so the
 * picker enforces this same number; there is one policy, not a client one and a
 * server one that can drift apart.
 */
export const CHAT_MAX_MEDIA_BYTES = 8 * 1024 * 1024;
/** A turn is a message plus a few files, not an upload session. */
export const CHAT_MAX_MEDIA_PER_TURN = 4;
/**
 * Largest JSON body the API will accept for a chat request.
 *
 * Only the last turn may carry media, so the bound is one turn's attachments
 * (base64 inflates raw bytes by a third) plus the longest legal transcript of
 * text. The API sizes its body parser from this value, which is what keeps a
 * request the contract allows from being rejected by the transport layer before
 * validation ever runs.
 */
export const CHAT_MAX_BODY_BYTES =
  Math.ceil((CHAT_MAX_MEDIA_PER_TURN * CHAT_MAX_MEDIA_BYTES * 4) / 3) +
  CHAT_MAX_HISTORY * CHAT_MESSAGE_MAX * 4 +
  1024 * 1024;

export type ChatRole = 'user' | 'assistant';

export interface ChatMedia {
  /** Base64, no data-URL prefix. */
  readonly data: string;
  readonly mimeType: string;
}

/**
 * One attachment, turned into English text the model can replay cheaply.
 *
 * Chat is stateless, so anything only the attachment could answer would be lost
 * on the next request: earliers turn are replayed as text. Deriving the text
 * once, when the file is attached, is what lets a later turn refer back to it.
 */
export interface ChatDerivation {
  /** Caption for an image, transcript for an audio clip. Always English. */
  readonly text: string;
}

export interface ChatTurn {
  readonly role: ChatRole;
  /** Prose the user typed, or the assistant's final answer. */
  readonly text: string;
  readonly images?: readonly ChatMedia[];
  readonly audio?: readonly ChatMedia[];
  /** What the model said each attachment contains; one entry per image or clip. */
  readonly derived?: readonly ChatDerivation[];
}

export interface ChatRequest {
  readonly messages: readonly ChatTurn[];
}

export interface ChatToolTrace {
  readonly name: string;
  /** Argument JSON exactly as the model emitted it. */
  readonly arguments: string;
  readonly ok: boolean;
  readonly result: string;
}

export interface ChatResponse {
  readonly reply: string;
  readonly tools: readonly ChatToolTrace[];
  readonly stopReason: 'final' | 'steps';
}

/** Image captioning and speech transcription both answer in prose. */
export interface DescribeRequest {
  readonly media: ChatMedia;
  readonly kind: 'image' | 'audio';
}

/** Always English: the prompt translates, so a later turn can replay it as-is. */
export interface DescribeResponse {
  readonly text: string;
}

export type SpeechFormat = 'wav' | 'mp3';

export interface SpeechRequest {
  readonly text: string;
  readonly voice?: 'female' | 'male';
  readonly format?: SpeechFormat;
}
