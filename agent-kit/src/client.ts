/**
 * Typed methods for the fourteen ADEXTO MCP tools.
 *
 * Every method is one `tools/call`. A refusal (an answer with a top-level `error`, such as
 * `unknown_market`) throws `AdextoToolError` carrying the tool's whole answer; `callTool` is the
 * untyped escape hatch that returns refusals as values instead.
 */
import { DEFAULT_MCP_URL } from "./constants.js";
import { AdextoToolError } from "./errors.js";
import { callTool, createMcpTransport, isRefusal, type McpTransportOptions } from "./mcp.js";
import type {
  AccessMessageResult,
  AddressedMarketInput,
  AskAgentInput,
  AskAgentResult,
  BuyTokenInput,
  BuyTokenResult,
  CheckStakeResult,
  HowToPayResult,
  ListMarketsResult,
  MarketDetail,
  MarketRef,
  PrepareClaimInput,
  PrepareClaimResult,
  PrepareLaunchInput,
  PrepareLaunchResult,
  PrepareStakeInput,
  PrepareStakeResult,
  QuoteBuyInput,
  QuoteBuyResult,
  RegisterLaunchInput,
  RegisterLaunchResult,
  ToolInfo,
  TradeHistoryInput,
  TradeHistoryResult,
} from "./types.js";

export type AdextoClientOptions = McpTransportOptions;

export function createAdextoClient(options: AdextoClientOptions = {}) {
  const transport = createMcpTransport({ ...options, url: options.url ?? DEFAULT_MCP_URL });

  async function call<T>(name: string, args: object): Promise<T> {
    const data = await callTool(transport, name, args as Record<string, unknown>);
    if (isRefusal(data)) throw new AdextoToolError(name, data.error, data.detail, data);
    return data as T;
  }

  return {
    url: transport.url,

    /** The server's tool list, with input schemas and annotations. */
    listTools: async (): Promise<ToolInfo[]> => (await transport.request<{ tools: ToolInfo[] }>("tools/list")).tools,

    /** Untyped call that returns refusals as values instead of throwing. */
    callTool: (name: string, args: Record<string, unknown> = {}) => callTool(transport, name, args),

    // ── read, free ──
    listMarkets: () => call<ListMarketsResult>("list_markets", {}),
    getMarket: (input: MarketRef) => call<MarketDetail>("get_market", input),
    quoteBuy: (input: QuoteBuyInput) => call<QuoteBuyResult>("quote_buy", input),
    howToPay: () => call<HowToPayResult>("how_to_pay", {}),
    tradeHistory: (input: TradeHistoryInput) => call<TradeHistoryResult>("trade_history", input),
    checkStake: (input: AddressedMarketInput) => call<CheckStakeResult>("check_stake", input),
    accessMessage: (input: AddressedMarketInput) => call<AccessMessageResult>("access_message", input),
    askAgent: (input: AskAgentInput) => call<AskAgentResult>("ask_agent", input),

    // ── paid ──
    /** Without `xPayment` this returns the 402 challenge; `buy()` signs it and calls again. */
    buyToken: (input: BuyTokenInput) => call<BuyTokenResult>("buy_token", input),
    /** Operator-signed demo purchase. Needs the `x-agent-key` header; not for your own funds. */
    payAndBuy: (input: MarketRef) => call<Record<string, unknown>>("pay_and_buy", input),

    // ── unsigned transactions, signed by your key ──
    prepareLaunch: (input: PrepareLaunchInput) => call<PrepareLaunchResult>("prepare_launch", input),
    registerLaunch: (input: RegisterLaunchInput) => call<RegisterLaunchResult>("register_launch", input),
    prepareStake: (input: PrepareStakeInput) => call<PrepareStakeResult>("prepare_stake", input),
    prepareClaim: (input: PrepareClaimInput) => call<PrepareClaimResult>("prepare_claim", input),
  };
}

export type AdextoClient = ReturnType<typeof createAdextoClient>;
