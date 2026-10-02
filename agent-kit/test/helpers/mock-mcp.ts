import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockCall {
  name: string;
  args: Record<string, unknown>;
  headers: IncomingHttpHeaders;
}

/** Return this from a handler to answer with `isError: true`. */
export class ToolFailure {
  constructor(readonly text: string) {}
}

type Handler = (args: Record<string, unknown>, callIndex: number) => unknown | Promise<unknown>;

/**
 * A stand-in MCP server: tools/list and tools/call over HTTP, answering as JSON or as SSE the way
 * mcp-handler does. Unknown tools answer with a JSON-RPC error.
 */
export async function startMockMcp(handlers: Record<string, Handler>, options: { sse?: boolean } = {}) {
  const calls: MockCall[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const msg = JSON.parse(raw || "{}");
      let reply: unknown;
      if (msg.method === "tools/list") {
        reply = { jsonrpc: "2.0", id: msg.id, result: { tools: Object.keys(handlers).map((name) => ({ name, inputSchema: { type: "object" } })) } };
      } else if (msg.method === "tools/call") {
        const name = String(msg.params?.name);
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        calls.push({ name, args, headers: req.headers });
        const handler = handlers[name];
        if (!handler) {
          reply = { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `Tool ${name} not found` } };
        } else {
          const out = await handler(args, calls.filter((c) => c.name === name).length - 1);
          reply =
            out instanceof ToolFailure
              ? { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: out.text }], isError: true } }
              : { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out) }] } };
        }
      } else {
        reply = { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
      }
      if (options.sse) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`: keep-alive\n\nevent: message\ndata: ${JSON.stringify(reply)}\n\n`);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/mcp`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
