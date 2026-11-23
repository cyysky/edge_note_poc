import type { Message, ToolCall, UserContentPart } from './messages.js';
import { AUDIO_TRANSCRIPT_PROMPT, IMAGE_CAPTION_PROMPT } from './prompts.js';
import { toWireTools, type AnyToolDefinition } from './tools.js';

/** Everything that can go wrong talking to llama-server, with the cause kept. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'http' | 'protocol' | 'aborted',
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface ModelClientOptions {
  /** Base URL of llama-server, e.g. `http://127.0.0.1:8080`. */
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export interface ChatRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly AnyToolDefinition[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly toolChoice?: 'auto' | 'none' | 'required';
}

export interface ChatResult {
  readonly message: {
    readonly role: 'assistant';
    readonly content: string;
    readonly toolCalls: readonly ToolCall[];
  };
  readonly finishReason: string | null;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
  readonly timings?: unknown;
}

interface WireContentPart {
  readonly type: string;
  readonly [key: string]: unknown;
}

function toWirePart(part: UserContentPart): WireContentPart {
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

/**
 * Translate our messages into the wire array llama-server expects.
 *
 * Tool arguments travel as JSON text: the model's chat template raises if it is
 * handed a stringified mapping, so we pass the original text straight through.
 */
export function toWireMessages(messages: readonly Message[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      const content =
        typeof message.content === 'string' ? message.content : message.content.map(toWirePart);
      return { role: 'user', content };
    }
    if (message.role === 'assistant') {
      const base: Record<string, unknown> = { role: 'assistant', content: message.content };
      if (message.toolCalls && message.toolCalls.length > 0) {
        base['tool_calls'] = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        }));
      }
      return base;
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return { role: 'system', content: message.content };
  });
}

interface WireChoice {
  readonly finish_reason?: string | null;
  readonly message?: {
    readonly role?: string;
    readonly content?: string | null;
    readonly tool_calls?: readonly {
      readonly id?: string;
      readonly function?: { readonly name?: string; readonly arguments?: unknown };
    }[];
  };
}

export class ModelClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ModelClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
    this.model = options.model ?? 'lfm3';
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toWireMessages(request.messages),
      temperature: request.temperature ?? 0,
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };
    if (request.tools && request.tools.length > 0) {
      body['tools'] = toWireTools(request.tools);
      body['tool_choice'] = request.toolChoice ?? 'auto';
    }

    const response = await this.request('/v1/chat/completions', body);
    const parsed = (await this.readJson(response)) as {
      choices?: readonly WireChoice[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      timings?: unknown;
    };
    const choice = parsed.choices?.[0];
    if (!choice) {
      throw new ModelError('Chat response contained no choices.', 'protocol');
    }

    const rawCalls = choice.message?.tool_calls ?? [];
    const toolCalls: ToolCall[] = rawCalls.map((call) => {
      const name = call.function?.name;
      if (!name) throw new ModelError('Tool call arrived without a name.', 'protocol');
      return {
        id: call.id ?? '',
        name,
        arguments: normalizeArguments(call.function?.arguments),
      };
    });

    return {
      message: {
        role: 'assistant',
        content: choice.message?.content ?? '',
        toolCalls,
      },
      finishReason: choice.finish_reason ?? null,
      usage: {
        promptTokens: parsed.usage?.prompt_tokens ?? 0,
        completionTokens: parsed.usage?.completion_tokens ?? 0,
      },
      ...(parsed.timings !== undefined ? { timings: parsed.timings } : {}),
    };
  }

  /**
   * Turn one attachment into English text.
   *
   * The answer is meant to outlive the bytes: chat replays history as text, so a
   * later turn can only refer to an attachment if this text was derived now.
   */
  async describe(
    media: { readonly mimeType: string; readonly data: string },
    kind: 'image' | 'audio',
    options: { readonly maxTokens?: number; readonly signal?: AbortSignal } = {},
  ): Promise<string> {
    const prompt = kind === 'image' ? IMAGE_CAPTION_PROMPT : AUDIO_TRANSCRIPT_PROMPT;
    const part =
      kind === 'image'
        ? { type: 'image' as const, mimeType: media.mimeType, data: media.data }
        : { type: 'audio' as const, mimeType: media.mimeType, data: media.data };
    const response = await this.request(
      '/v1/chat/completions',
      {
        model: this.model,
        messages: toWireMessages([
          { role: 'user', content: [{ type: 'text', text: prompt }, part] },
        ]),
        temperature: 0,
        max_tokens: options.maxTokens ?? 400,
      },
      options.signal,
    );
    const parsed = (await this.readJson(response)) as {
      choices?: readonly { message?: { content?: string | null } }[];
    };
    const text = parsed.choices?.[0]?.message?.content?.trim() ?? '';
    if (text.length === 0) {
      throw new ModelError('The model returned an empty description.', 'protocol');
    }
    return text;
  }

  /** Speech synthesis. Returns raw audio bytes; the caller owns the container. */
  async speak(
    text: string,
    options: { readonly voice?: string; readonly language?: string; readonly format?: string } = {},
  ): Promise<Uint8Array> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: text,
      response_format: options.format ?? 'wav',
      ...(options.voice ? { voice: options.voice } : {}),
      ...(options.language ? { language: options.language } : {}),
    };
    const response = await this.request('/v1/audio/speech', body);
    return new Uint8Array(await response.arrayBuffer());
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.request('/health');
      return response.ok;
    } catch {
      return false;
    }
  }

  private async request(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // Both: the caller's cancellation and the client-wide timeout, so a
        // closed dialog stops the work but a hung server is still bounded.
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ModelError(`Model request timed out after ${this.timeoutMs}ms.`, 'aborted');
      }
      throw new ModelError(
        `Could not reach llama-server at ${this.baseUrl}. Is it running?`,
        'unreachable',
        undefined,
        error instanceof Error ? error.message : undefined,
      );
    }

    if (!response.ok) {
      const text = await safeText(response);
      throw new ModelError(
        `llama-server returned ${response.status} for ${path}.`,
        'http',
        response.status,
        text,
      );
    }
    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ModelError(
        'llama-server returned a non-JSON body.',
        'protocol',
        response.status,
        text,
      );
    }
  }
}

/**
 * The model may emit arguments as a JSON string (normal) or, with some
 * templates, as an already-parsed object. Both become JSON text so validation
 * stays a single code path.
 */
function normalizeArguments(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '{}' : value;
  if (value === undefined || value === null) return '{}';
  return JSON.stringify(value);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
