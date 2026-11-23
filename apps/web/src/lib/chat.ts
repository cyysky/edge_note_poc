import type {
  ChatRequest,
  ChatResponse,
  ChatTurn,
  DescribeRequest,
  DescribeResponse,
  SpeechRequest,
} from '@displayer/shared';

import { API_BASE_URL, ApiError } from './api';

/**
 * Chat is a POST with a JSON body, so it bypasses the small JSON helper in
 * `api.ts` only to keep its own error text specific to the model server.
 */
export async function sendChat(messages: readonly ChatTurn[]): Promise<ChatResponse> {
  const request: ChatRequest = { messages };
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is it running?');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'CHAT_FAILED',
      body?.error?.message ?? `The chat request failed (${response.status}).`,
    );
  }

  return (await response.json()) as ChatResponse;
}

/**
 * Caption or transcribe one file.
 *
 * Called while the file is still an attachment, so a person sees the text that
 * will represent it in every later turn. Slow by nature: it is a model call.
 */
export async function describeMedia(request: DescribeRequest): Promise<DescribeResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/chat/describe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is it running?');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiError(
      response.status,
      'DESCRIBE_FAILED',
      body?.error?.message ?? `The file could not be described (${response.status}).`,
    );
  }

  return (await response.json()) as DescribeResponse;
}

/** Speech comes back as bytes, so the caller gets a playable object URL. */
export async function fetchSpeech(request: SpeechRequest): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/chat/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ApiError(
      response.status,
      'SPEECH_FAILED',
      body?.error?.message ?? `Speech synthesis failed (${response.status}).`,
    );
  }
  return response.blob();
}
