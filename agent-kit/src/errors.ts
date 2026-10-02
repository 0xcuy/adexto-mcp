/** A JSON-RPC level failure: the server could not run the request at all. */
export class McpError extends Error {
  override name = "McpError";
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
  }
}

/**
 * A tool answered with a refusal, for example `unknown_market` or `below_minimum`.
 *
 * `code` is the tool's own error code and `data` is its whole answer, so a caller can read the
 * extra fields a refusal carries (a minimum, the market's token address, a retry delay).
 */
export class AdextoToolError extends Error {
  override name = "AdextoToolError";
  constructor(
    readonly tool: string,
    readonly code: string,
    readonly detail: string | undefined,
    readonly data: unknown
  ) {
    super(`${tool}: ${code}${detail ? `: ${detail}` : ""}`);
  }
}

/** The kit refused to sign a transaction or payment because it did not match what was asked for. */
export class UnsafeTransactionError extends Error {
  override name = "UnsafeTransactionError";
  constructor(
    readonly reason: string,
    readonly transaction?: unknown
  ) {
    super(reason);
  }
}
