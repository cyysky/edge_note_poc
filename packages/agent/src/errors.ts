/**
 * Errors a tool may throw. Anything else is treated as a bug: it is reported to
 * the model as an opaque failure so the loop can recover, while the original is
 * kept in `cause` for logs.
 */
export class ToolError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ToolError';
  }
}

export class InvalidToolArgumentsError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: readonly { readonly path: string; readonly message: string }[],
  ) {
    super(
      `Arguments for ${toolName} are invalid: ${issues
        .map((issue) => `${issue.path || '<root>'} ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'InvalidToolArgumentsError';
  }
}
