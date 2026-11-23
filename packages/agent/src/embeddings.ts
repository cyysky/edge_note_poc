import type { AudioPart, ImagePart, TextPart, VideoPart } from './messages.js';

/**
 * Client for the EmbeddingGemma 2 server (`llama-server --embeddings`).
 *
 * Text and media take different wire shapes: text goes through `input: string[]`
 * and may carry a task prompt, media must be sent as content parts and must NOT
 * carry one. Both come back as 768-dimension vectors, so they are only
 * comparable when both sides were produced by this same model.
 */

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'http' | 'protocol' | 'aborted',
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export interface EmbeddingClientOptions {
  /** Base URL of the embedding llama-server, e.g. `http://127.0.0.1:8091`. */
  readonly baseUrl?: string;
  /** llama-server requires a model name; it ignores which one you send. */
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export type MediaPart = ImagePart | AudioPart | VideoPart;
export type EmbeddingPart = TextPart | MediaPart;

/**
 * Asymmetric retrieval prompts, verbatim from the EmbeddingGemma model card.
 *
 * The prefix is not decoration: without it the retrieval score drops sharply,
 * because the model was trained to place "search result" queries and
 * "title/text" documents in the same region only when labelled this way.
 */
export function queryPrompt(query: string): string {
  return `task: search result | query: ${query.trim()}`;
}

export function documentPrompt(document: {
  readonly title?: string | undefined;
  readonly text: string;
}): string {
  const title = document.title?.trim() ?? '';
  return `title: ${title.length > 0 ? title : 'none'} | text: ${document.text.trim()}`;
}

/** Cosine similarity; zero vectors score 0 rather than dividing by zero. */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error(`Cannot compare vectors of ${left.length} and ${right.length} dimensions.`);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export interface Scored<T> {
  readonly item: T;
  readonly score: number;
}

/** Sort by score descending, keeping input order for ties. */
export function rankBySimilarity<T>(
  query: readonly number[],
  items: readonly T[],
  vectors: readonly (readonly number[])[],
  limit = items.length,
): Scored<T>[] {
  if (items.length !== vectors.length) {
    throw new Error('Every item needs exactly one vector to be ranked.');
  }
  const scored = items.map((item, index) => ({
    item,
    score: cosineSimilarity(query, vectors[index] ?? []),
    index,
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(0, limit)).map(({ item, score }) => ({ item, score }));
}

interface WirePart {
  readonly type: string;
  readonly [key: string]: unknown;
}

function toWirePart(part: EmbeddingPart): WirePart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
    case 'audio':
      return {
        type: 'input_audio',
        input_audio: { data: part.data, format: part.mimeType.split('/')[1] ?? 'wav' },
      };
    case 'video':
      return { type: 'video_url', video_url: { url: `data:${part.mimeType};base64,${part.data}` } };
  }
}

/** Text is sent in a batch so one HTTP round trip covers a whole note corpus. */
type WireInput = readonly string[] | readonly { readonly content: readonly WirePart[] }[];

export class EmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EmbeddingClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8091').replace(/\/+$/, '');
    this.model = options.model ?? 'embed';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Embed documents already formatted with `documentPrompt`. */
  async embedTexts(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embed(texts);
  }

  /** One media item, no task prefix: the model card forbids prefixing media. */
  async embedMedia(parts: readonly MediaPart[]): Promise<number[]> {
    if (parts.length === 0) throw new Error('embedMedia needs at least one media part.');
    const vectors = await this.call([{ content: parts.map(toWirePart) }], 1);
    return vectors[0] ?? [];
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embedTexts([queryPrompt(query)]);
    if (!vector) throw new EmbeddingError('Embedding server returned no vector.', 'protocol');
    return vector;
  }

  async embedDocuments(
    documents: readonly { readonly title?: string; readonly text: string }[],
  ): Promise<number[][]> {
    return this.embedTexts(documents.map(documentPrompt));
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.send('/health', undefined);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async embed(texts: readonly string[]): Promise<number[][]> {
    return this.call(texts, texts.length);
  }

  private async call(input: WireInput, expected: number): Promise<number[][]> {
    const response = await this.send('/v1/embeddings', { model: this.model, input });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new EmbeddingError(
        'Embedding server returned a non-JSON body.',
        'protocol',
        response.status,
      );
    }

    const data = (parsed as { data?: readonly { embedding?: unknown; index?: number }[] }).data;
    if (!Array.isArray(data)) {
      throw new EmbeddingError(
        'Embedding response has no data array.',
        'protocol',
        response.status,
      );
    }
    const ordered = [...data].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    const vectors = ordered.map((entry) => {
      const values = entry.embedding as unknown[];
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'number')) {
        throw new EmbeddingError(
          'Embedding entry is not a numeric vector.',
          'protocol',
          response.status,
        );
      }
      return values as number[];
    });

    if (vectors.length !== expected) {
      throw new EmbeddingError(
        `Expected ${expected} embeddings, received ${vectors.length}.`,
        'protocol',
        response.status,
      );
    }
    return vectors;
  }

  private async send(path: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body !== undefined ? { headers: { 'content-type': 'application/json' } } : {}),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new EmbeddingError(
          `Embedding request timed out after ${this.timeoutMs}ms.`,
          'aborted',
        );
      }
      throw new EmbeddingError(
        `Embedding server is unreachable at ${this.baseUrl}. Start it with start_embed.bat in LFM3_OMNI_ROOT (or pnpm embed:serve).`,
        'unreachable',
        undefined,
        error instanceof Error ? error.message : undefined,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new EmbeddingError(
        `Embedding server returned ${response.status} for ${path}.`,
        'http',
        response.status,
        text,
      );
    }
    return response;
  }
}

export function createEmbeddingClient(options: EmbeddingClientOptions = {}): EmbeddingClient {
  return new EmbeddingClient(options);
}
