import { z } from 'zod';

/**
 * Tool definitions are plain data so they can be sent to the model verbatim,
 * listed for a UI, and unit-tested without any model in the loop.
 */

export interface ToolDefinition<
  Schema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  readonly name: string;
  readonly description: string;
  readonly schema: Schema;
  /** Instructions returned to the model when a call fails validation. */
  readonly invalidArgumentHint?: string;
}

export function defineTool<Schema extends z.ZodObject<z.ZodRawShape>>(
  definition: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return definition;
}

export type AnyToolDefinition = ToolDefinition<z.ZodObject<z.ZodRawShape>>;

export type ToolArguments<Definition extends AnyToolDefinition> = z.infer<Definition['schema']>;

/** JSON Schema as the chat-completions `tools[].function.parameters` field wants it. */
export interface ToolJsonSchema {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/**
 * Convert a Zod object schema into the JSON Schema the model reads.
 *
 * Zod 4 emits a `$schema` key that llama-server passes through untouched; the
 * model does not need it and some templates render it as noise, so it is
 * dropped here.
 */
export function toJsonSchema(schema: z.ZodObject<z.ZodRawShape>): ToolJsonSchema {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = json;
  return {
    type: 'object',
    properties: (rest['properties'] as Record<string, unknown> | undefined) ?? {},
    ...(rest['required'] ? { required: rest['required'] as readonly string[] } : {}),
    additionalProperties: (rest['additionalProperties'] as boolean | undefined) ?? false,
  };
}

export interface WireTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: ToolJsonSchema;
  };
}

export function toWireTools(tools: readonly AnyToolDefinition[]): WireTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.schema),
    },
  }));
}
