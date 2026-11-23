import type { ModelClient } from './client.js';
import { InvalidToolArgumentsError, ToolError } from './errors.js';
import type { Message, ToolCall, UserMessage } from './messages.js';
import type { AnyToolDefinition, ToolArguments } from './tools.js';

/**
 * Tools receive a context rather than the loop itself, so they cannot re-enter
 * the model. Anything the agent should know to do next belongs in a tool.
 */
export interface ToolContext {
  readonly signal: AbortSignal;
  /** Emit a progress line for a UI or CLI without touching the transcript. */
  readonly log: (message: string) => void;
}

export interface AgentTool<Definition extends AnyToolDefinition = AnyToolDefinition> {
  readonly definition: Definition;
  execute(args: ToolArguments<Definition>, context: ToolContext): Promise<unknown> | unknown;
}

/** Helper that keeps the argument type tied to the Zod schema. */
export function defineAgentTool<Definition extends AnyToolDefinition>(
  definition: Definition,
  execute: (args: ToolArguments<Definition>, context: ToolContext) => Promise<unknown> | unknown,
): AgentTool<Definition> {
  return { definition, execute };
}

export type AgentEvent =
  | { readonly type: 'turn-start'; readonly turn: number }
  | { readonly type: 'assistant-text'; readonly text: string }
  | { readonly type: 'tool-call'; readonly call: ToolCall }
  | {
      readonly type: 'tool-result';
      readonly call: ToolCall;
      readonly ok: boolean;
      readonly preview: string;
    }
  | { readonly type: 'final'; readonly text: string }
  | { readonly type: 'limit'; readonly reason: 'steps' };

export interface AgentOptions {
  readonly client: ModelClient;
  readonly tools: readonly AgentTool[];
  readonly system: string;
  /**
   * Turns to replay before the new prompt, oldest first. Media in earlier turns
   * is the caller's problem: replaying it re-sends the bytes on every request.
   */
  readonly history?: readonly Message[];
  /** Hard cap on model calls. Each tool round trip costs one. */
  readonly maxSteps?: number;
  readonly temperature?: number;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly signal?: AbortSignal;
}

export interface AgentResult {
  readonly text: string;
  readonly stopReason: 'final' | 'steps';
  readonly messages: readonly Message[];
  readonly toolCalls: number;
}

const MAX_OBSERVATION_CHARS = 8_000;

/** Result payloads are truncated so one huge tool result cannot blow the window. */
function truncate(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= MAX_OBSERVATION_CHARS) return text;
  return `${text.slice(0, MAX_OBSERVATION_CHARS)}\n…[truncated ${text.length - MAX_OBSERVATION_CHARS} chars]`;
}

function parseArguments(call: ToolCall): unknown {
  try {
    return JSON.parse(call.arguments) as unknown;
  } catch {
    throw new InvalidToolArgumentsError(call.name, [
      { path: '', message: 'arguments are not valid JSON' },
    ]);
  }
}

function formatIssues(error: InvalidToolArgumentsError): string {
  return JSON.stringify({
    error: 'invalid_arguments',
    tool: error.toolName,
    issues: error.issues,
    hint: 'Retry with arguments matching the tool schema exactly.',
  });
}

function describeFailure(error: unknown, toolName: string): string {
  if (error instanceof ToolError) {
    return JSON.stringify({ error: 'tool_failed', tool: toolName, message: error.message });
  }
  return JSON.stringify({
    error: 'tool_failed',
    tool: toolName,
    message: 'The tool threw an unexpected error.',
  });
}

/**
 * Run one conversation to completion.
 *
 * The loop is deliberately dumb: ask, execute every call the model asked for,
 * feed results back, repeat. Everything model-specific (schemas, prompt
 * format, media encoding) lives in the client and tools.
 */
export async function runAgent(
  options: AgentOptions,
  prompt: string | UserMessage,
): Promise<AgentResult> {
  const maxSteps = options.maxSteps ?? 12;
  const toolsByName = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
  const definitions = options.tools.map((tool) => tool.definition);

  const messages: Message[] = [
    { role: 'system', content: options.system },
    ...(options.history ?? []),
  ];
  const userMessage: UserMessage =
    typeof prompt === 'string' ? { role: 'user', content: prompt } : prompt;
  messages.push(userMessage);

  const controller = new AbortController();
  const externalAbort = options.signal;
  const forwardAbort = () => controller.abort(externalAbort?.reason);
  externalAbort?.addEventListener('abort', forwardAbort, { once: true });

  const context: ToolContext = {
    signal: controller.signal,
    log: (message) => options.onEvent?.({ type: 'assistant-text', text: message }),
  };

  let toolCalls = 0;

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      options.onEvent?.({ type: 'turn-start', turn: step + 1 });

      const response = await options.client.chat({
        messages,
        tools: definitions,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      });

      const assistant = {
        role: 'assistant' as const,
        content: response.message.content,
        ...(response.message.toolCalls.length > 0 ? { toolCalls: response.message.toolCalls } : {}),
      };
      messages.push(assistant);

      if (response.message.content) {
        options.onEvent?.({ type: 'assistant-text', text: response.message.content });
      }

      if (response.message.toolCalls.length === 0) {
        options.onEvent?.({ type: 'final', text: response.message.content });
        return {
          text: response.message.content,
          stopReason: 'final',
          messages,
          toolCalls,
        };
      }

      for (const call of response.message.toolCalls) {
        toolCalls += 1;
        options.onEvent?.({ type: 'tool-call', call });
        const observation = await executeTool(call, toolsByName, context);
        options.onEvent?.({
          type: 'tool-result',
          call,
          ok: observation.ok,
          preview: observation.content.slice(0, 200),
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: observation.content,
          ...(observation.ok ? {} : { isError: true }),
        });
      }
    }
  } finally {
    externalAbort?.removeEventListener('abort', forwardAbort);
  }

  options.onEvent?.({ type: 'limit', reason: 'steps' });
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  return {
    text: lastAssistant && lastAssistant.role === 'assistant' ? lastAssistant.content : '',
    stopReason: 'steps',
    messages,
    toolCalls,
  };
}

async function executeTool(
  call: ToolCall,
  toolsByName: ReadonlyMap<string, AgentTool>,
  context: ToolContext,
): Promise<{ readonly ok: boolean; readonly content: string }> {
  const tool = toolsByName.get(call.name);
  if (!tool) {
    return {
      ok: false,
      content: JSON.stringify({
        error: 'unknown_tool',
        tool: call.name,
        available: [...toolsByName.keys()],
      }),
    };
  }

  let args: unknown;
  try {
    args = parseArguments(call);
  } catch (error) {
    return { ok: false, content: formatIssues(error as InvalidToolArgumentsError) };
  }

  const parsed = tool.definition.schema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    return {
      ok: false,
      content: formatIssues(new InvalidToolArgumentsError(call.name, issues)),
    };
  }

  try {
    const result = await tool.execute(parsed.data, context);
    return { ok: true, content: truncate(result) };
  } catch (error) {
    return { ok: false, content: describeFailure(error, call.name) };
  }
}
