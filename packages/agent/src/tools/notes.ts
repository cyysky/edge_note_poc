import {
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  validateNoteInput,
  type Note,
  type NoteListResponse,
} from '@displayer/shared';
import { z } from 'zod';

import { createEmbeddingClient, rankBySimilarity, type EmbeddingClient } from '../embeddings.js';
import { ToolError } from '../errors.js';
import { defineAgentTool, type AgentTool } from '../runner.js';
import { defineTool } from '../tools.js';

/**
 * Notes tools talk to the Nest API over HTTP rather than opening the database.
 *
 * That keeps one writer: the API owns validation, timestamps and ids, so an
 * agent-created note is indistinguishable from one made in the UI.
 */
export interface NotesApiOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  /** Defaults to the local EmbeddingGemma server on port 8091. */
  readonly embedder?: EmbeddingClient;
}

const NoteId = z.string().min(1).describe('Exact note id, as returned by list_notes.');

export const listNotesTool = defineTool({
  name: 'list_notes',
  description:
    'List saved notes, newest first. Use this before editing, deleting or answering questions about existing notes.',
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional().describe('Maximum notes to return.'),
  }),
});

export const searchNotesTool = defineTool({
  name: 'search_notes',
  description:
    'Semantically search saved notes with EmbeddingGemma 2. Use for fuzzy topics; use list_notes when you need every note.',
  schema: z.object({
    query: z.string().min(1).describe('Natural-language description of what to find.'),
    limit: z.number().int().min(1).max(20).optional(),
  }),
});

export const getNoteTool = defineTool({
  name: 'get_note',
  description: 'Read the full body of one note by id.',
  schema: z.object({ id: NoteId }),
});

export const createNoteTool = defineTool({
  name: 'create_note',
  description: `Create a note. Title is required and at most ${NOTE_TITLE_MAX} characters; body is optional and at most ${NOTE_BODY_MAX}.`,
  schema: z.object({
    title: z.string().min(1).max(NOTE_TITLE_MAX),
    body: z.string().max(NOTE_BODY_MAX).optional(),
  }),
  invalidArgumentHint: 'Title must be non-empty and short; put prose in body.',
});

export const updateNoteTool = defineTool({
  name: 'update_note',
  description: 'Replace the title and body of an existing note. Read it first with get_note.',
  schema: z.object({
    id: NoteId,
    title: z.string().min(1).max(NOTE_TITLE_MAX),
    body: z.string().max(NOTE_BODY_MAX).optional(),
  }),
});

export const deleteNoteTool = defineTool({
  name: 'delete_note',
  description: 'Permanently delete a note by id. Confirm with the user before calling this.',
  schema: z.object({ id: NoteId }),
});

export const notesToolDefinitions = [
  listNotesTool,
  searchNotesTool,
  getNoteTool,
  createNoteTool,
  updateNoteTool,
  deleteNoteTool,
] as const;

export interface SearchHit {
  readonly note: Note;
  readonly score: number;
}

export interface NotesBackend {
  list(limit?: number): Promise<Note[]>;
  get(id: string): Promise<Note>;
  create(input: { readonly title: string; readonly body: string }): Promise<Note>;
  update(id: string, input: { readonly title: string; readonly body: string }): Promise<Note>;
  remove(id: string): Promise<void>;
  search(query: string, limit: number): Promise<SearchHit[]>;
}

export function createNotesBackend(options: NotesApiOptions = {}): NotesBackend {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetch ?? fetch;
  const embedder = options.embedder ?? createEmbeddingClient();

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ToolError(`Notes API is unreachable at ${baseUrl}. Start it with \`pnpm dev\`.`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ToolError(
        `Notes API returned ${response.status} for ${path}: ${body.slice(0, 300)}`,
      );
    }
    return response;
  }

  async function listAll(): Promise<Note[]> {
    const response = await call('/api/notes');
    const data = (await response.json()) as NoteListResponse;
    return [...data.items];
  }

  return {
    async list(limit) {
      const items = await listAll();
      return limit ? items.slice(0, limit) : items;
    },

    async get(id) {
      const response = await call(`/api/notes/${encodeURIComponent(id)}`);
      return (await response.json()) as Note;
    },

    async create(input) {
      const response = await call('/api/notes', {
        method: 'POST',
        body: JSON.stringify(requireValid(input)),
      });
      return (await response.json()) as Note;
    },

    async update(id, input) {
      const response = await call(`/api/notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(requireValid(input)),
      });
      return (await response.json()) as Note;
    },

    async remove(id) {
      await call(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /**
     * Retrieval is in-process: the corpus is small enough that re-embedding it
     * per search beats keeping a vector index in sync with every write.
     */
    async search(query, limit) {
      const notes = await listAll();
      if (notes.length === 0) return [];
      const [queryVector, vectors] = await Promise.all([
        embedder.embedQuery(query),
        embedder.embedDocuments(notes.map((note) => ({ title: note.title, text: note.body }))),
      ]);
      return rankBySimilarity(queryVector, notes, vectors, limit).map((scored) => ({
        note: scored.item,
        score: scored.score,
      }));
    },
  };
}

/** Local validation catches bad tool input before a round trip. */
function requireValid(input: { readonly title: string; readonly body?: string }): {
  readonly title: string;
  readonly body: string;
} {
  const result = validateNoteInput({ title: input.title, body: input.body ?? '' });
  if (!result.ok) {
    throw new ToolError(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  return result.value;
}

/** Compact note rendering: ids stay visible so the model can follow up. */
export function summariseNote(note: Note): string {
  const body = note.body.length > 280 ? `${note.body.slice(0, 280)}…` : note.body;
  return `[${note.id}] ${note.title}${body ? ` — ${body}` : ''}`;
}

/**
 * Wrap the notes backend as agent tools.
 *
 * LFM3 emits one call per turn in practice, so every tool here is a single,
 * complete operation: no tool depends on state a sibling tool would have set.
 */
export function createNotesTools(backend: NotesBackend = createNotesBackend()): AgentTool[] {
  return [
    defineAgentTool(listNotesTool, async (args) => {
      const notes = await backend.list(args.limit);
      return {
        count: notes.length,
        notes: notes.map((note) => ({
          id: note.id,
          title: note.title,
          updatedAt: note.updatedAt,
        })),
      };
    }),

    defineAgentTool(searchNotesTool, async (args) => {
      const hits = await backend.search(args.query, args.limit ?? 8);
      return {
        count: hits.length,
        hits: hits.map((hit) => ({
          id: hit.note.id,
          title: hit.note.title,
          score: Number(hit.score.toFixed(4)),
          excerpt: hit.note.body.slice(0, 400),
        })),
      };
    }),

    defineAgentTool(getNoteTool, async (args) => backend.get(args.id)),

    defineAgentTool(createNoteTool, async (args) => ({
      created: await backend.create({ title: args.title, body: args.body ?? '' }),
    })),

    defineAgentTool(updateNoteTool, async (args) => ({
      updated: await backend.update(args.id, { title: args.title, body: args.body ?? '' }),
    })),

    defineAgentTool(deleteNoteTool, async (args) => {
      await backend.remove(args.id);
      return { deleted: args.id };
    }),
  ];
}
