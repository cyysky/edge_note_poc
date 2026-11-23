import type { ApiErrorResponse, Note, NoteInput } from '@displayer/shared';

/**
 * Browser requests use a same-origin path and are proxied to the API by the
 * rewrite in `next.config.ts`, so there is no CORS hop and no build-time URL to
 * get wrong. Server rendering talks to the API directly.
 */
export const API_BASE_URL =
  typeof window === 'undefined' ? (process.env.API_BASE_URL ?? 'http://127.0.0.1:3001') : '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return new ApiError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.details ?? [],
    );
  } catch {
    return new ApiError(response.status, 'NETWORK_ERROR', `Request failed (${response.status}).`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is it running?');
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function listNotes(): Promise<Note[]> {
  const body = await request<{ items: Note[] }>('/api/notes');
  return body.items;
}

export async function createNote(input: NoteInput): Promise<Note> {
  return request<Note>('/api/notes', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateNote(id: string, input: NoteInput): Promise<Note> {
  return request<Note>(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export async function deleteNote(id: string): Promise<void> {
  await request<void>(`/api/notes/${id}`, { method: 'DELETE' });
}
