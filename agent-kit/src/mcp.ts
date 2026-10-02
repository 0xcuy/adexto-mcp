/**
 * A minimal MCP client over Streamable HTTP: JSON-RPC 2.0 POSTs, answers read as JSON or as SSE.
 *
 * No SDK and no session. The ADEXTO server is stateless and answers `tools/list` and `tools/call`
 * without an `initialize` round trip, so this is the whole client.
 */
import { AdextoToolError, McpError } from "./errors.js";

export interface McpTransportOptions {
  /** Defaults to https://adexto.xyz/api/mcp. */
  url?: string;
  /** Extra request headers, for example `x-agent-key` for the operator-signed pay_and_buy tool. */
  headers?: Record<string, string>;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per request. Defaults to 120 seconds, because prepare_launch anchors metadata before it answers. */
  timeoutMs?: number;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTransport {
  readonly url: string;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

/**
 * The JSON-RPC answer with `id`, from a JSON body or from an SSE stream. In SSE each event's
 * `data:` lines are joined with newlines, as the SSE format defines; the event whose message
 * carries the request id wins, and a stream without one falls back to its last parsable message.
 */
export function parseRpcResponse(body: string, id: number): JsonRpcResponse | null {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      return null;
    }
  }
  const messages: JsonRpcResponse[] = [];
  for (const event of body.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      messages.push(JSON.parse(data) as JsonRpcResponse);
    } catch {
      // not a JSON-RPC message (a comment or a keep-alive)
    }
  }
  return messages.find((m) => m.id === id) ?? messages.filter((m) => "result" in m || "error" in m).pop() ?? null;
}

export function createMcpTransport(options: McpTransportOptions = {}): McpTransport {
  const url = options.url ?? "https://adexto.xyz/api/mcp";
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  let nextId = 0;

  return {
    url,
    async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      const id = ++nextId;
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...options.headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const message = parseRpcResponse(text, id);
      if (!message) {
        throw new McpError(-32603, `No JSON-RPC answer from ${url} (HTTP ${res.status}): ${text.slice(0, 160)}`);
      }
      if (message.error) throw new McpError(message.error.code, message.error.message, message.error.data);
      return message.result as T;
    },
  };
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Call one tool and return its answer as a value. ADEXTO tools answer with one JSON text block;
 * `structuredContent` is preferred when a server sends it. A result flagged `isError` throws.
 */
export async function callTool(transport: McpTransport, name: string, args: Record<string, unknown>): Promise<unknown> {
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  const result = await transport.request<ToolCallResult>("tools/call", { name, arguments: clean });
  const text = result?.content?.find((c) => c.type === "text")?.text;
  let data: unknown = result?.structuredContent;
  if (data === undefined && text !== undefined) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (result?.isError) {
    const detail = typeof data === "string" ? data : text;
    throw new AdextoToolError(name, "tool_error", detail?.slice(0, 300), data);
  }
  return data;
}

/** A tool answer that is a refusal: an object with a top-level string `error`. */
export function isRefusal(data: unknown): data is { error: string; detail?: string } {
  return typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string";
}
