import { afterEach, describe, expect, it } from "vitest";
import { AdextoToolError, McpError, createAdextoClient, parseRpcResponse } from "../src/index.js";
import { startMockMcp, ToolFailure } from "./helpers/mock-mcp.js";

describe("parseRpcResponse", () => {
  it("reads a JSON body", () => {
    expect(parseRpcResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', 1)?.result).toEqual({ ok: true });
  });

  it("reads SSE, skips comments and picks the message with the request id", () => {
    const body = [
      ": keep-alive",
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":7,"result":{"n":7}}',
      "",
    ].join("\n");
    expect(parseRpcResponse(body, 7)?.result).toEqual({ n: 7 });
  });

  it("joins multi-line SSE data", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":3,"result":1}\n\n';
    expect(parseRpcResponse(body, 3)?.result).toBe(1);
  });

  it("returns null for something that is not JSON-RPC", () => {
    expect(parseRpcResponse("<html>bad gateway</html>", 1)).toBeNull();
  });
});

describe.each([false, true])("client (sse=%s)", (sse) => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it("returns typed answers and strips undefined arguments", async () => {
    const mock = await startMockMcp({ get_market: (args) => ({ symbol: String(args.symbol), chainId: 143, token: "0x1", curve: "0x2" }) }, { sse });
    close = mock.close;
    const client = createAdextoClient({ url: mock.url });
    const m = await client.getMarket({ symbol: "PARCEL", chainId: undefined });
    expect(m.symbol).toBe("PARCEL");
    expect(mock.calls[0]?.args).toEqual({ symbol: "PARCEL" });
    expect((await client.listTools()).map((t) => t.name)).toEqual(["get_market"]);
  });

  it("throws AdextoToolError for a refusal, with the whole answer", async () => {
    const mock = await startMockMcp({ prepare_stake: () => ({ error: "below_minimum", detail: "too small", minimum: "10000.0" }) }, { sse });
    close = mock.close;
    const client = createAdextoClient({ url: mock.url });
    const err = await client
      .prepareStake({ symbol: "X", chainId: 1, address: "0x0000000000000000000000000000000000000001", amount: "1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AdextoToolError);
    expect(err.code).toBe("below_minimum");
    expect((err.data as { minimum: string }).minimum).toBe("10000.0");
  });

  it("callTool returns refusals as values", async () => {
    const mock = await startMockMcp({ get_market: () => ({ error: "unknown_market" }) }, { sse });
    close = mock.close;
    expect(await createAdextoClient({ url: mock.url }).callTool("get_market", { symbol: "NOPE" })).toEqual({ error: "unknown_market" });
  });

  it("throws for isError results and JSON-RPC errors, and sends custom headers", async () => {
    const mock = await startMockMcp({ how_to_pay: () => new ToolFailure("Input validation error") }, { sse });
    close = mock.close;
    const client = createAdextoClient({ url: mock.url, headers: { "x-agent-key": "k" } });
    await expect(client.howToPay()).rejects.toMatchObject({ name: "AdextoToolError", code: "tool_error" });
    expect(mock.calls[0]?.headers["x-agent-key"]).toBe("k");
    await expect(client.listMarkets()).rejects.toBeInstanceOf(McpError);
  });
});
