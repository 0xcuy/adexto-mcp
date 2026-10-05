/**
 * Shapes of the ADEXTO MCP tools, read from the live server's tools/list and from its answers.
 *
 * Outputs list the fields an agent acts on. Every output also allows extra keys, because the server
 * adds fields over time and a client that rejects unknown keys breaks on the next release.
 */
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

type Open = { [key: string]: unknown };

// ── inputs ──────────────────────────────────────────────────────────────────

export interface MarketRef {
  /** Ticker, for example "PARCEL". */
  symbol: string;
  /** Needed when a ticker trades on more than one chain. list_markets shows chainId. */
  chainId?: number;
}

export interface QuoteBuyInput extends MarketRef {
  to?: Address;
}

export interface BuyTokenInput extends MarketRef {
  /** Address that receives the tokens. */
  to: Address;
  /** Base64 x402 payment payload. Omit it to receive the 402 challenge. */
  xPayment?: string;
}

export interface TradeHistoryInput extends MarketRef {
  limit?: number;
}

export interface AddressedMarketInput extends MarketRef {
  address: Address;
}

export interface AskAgentInput extends AddressedMarketInput {
  /** The exact message access_message returned. */
  message: string;
  /** EIP-191 signature of that message by `address`. */
  signature: Hex;
  question: string;
}

export interface LaunchMetadata {
  description?: string;
  website?: string;
  x?: string;
  github?: string;
  docs?: string;
  /** Logo as a base64 data URI (png, jpeg or webp). */
  image?: string;
  category?: string;
}

export interface PrepareLaunchInput extends LaunchMetadata {
  chainId: number;
  name: string;
  symbol: string;
  deployer: Address;
  /** ERC-8004 agent id on this chain, owned by the deployer, to bind to the token. */
  agentId?: string;
  attestationMessage?: string;
  attestationSignature?: Hex;
}

export interface RegisterLaunchInput {
  chainId: number;
  txHash: Hex;
}

export interface PrepareStakeInput extends AddressedMarketInput {
  /** Whole tokens, for example "10000". */
  amount: string;
}

export interface PrepareClaimInput {
  address: Address;
  chainId?: number;
}

// ── outputs ─────────────────────────────────────────────────────────────────

export interface AgentIdentity extends Open {
  agentId: string;
  agentRegistry: string;
  standard?: string;
  source?: string;
}

export interface MarketSummary extends Open {
  symbol: string;
  name: string;
  chainId: number;
  chain: string;
  nativeSymbol: string;
  token: Address;
  curve: Address;
  tradable: boolean;
  priceNative: number;
  /** Which read path serves trade_history for this market. */
  historySource: "indexer" | "market-index" | "rpc-logs" | string;
  agentIdentity: AgentIdentity | null;
}

export interface ListMarketsResult extends Open {
  count: number;
  markets: MarketSummary[];
}

export interface StakingSummary extends Open {
  contract: Address;
  kind: "hub" | "dedicated" | string;
  minStake: number;
  token: Address;
  howToStake: string;
  lock: string;
}

export interface MarketDetail extends Open {
  symbol: string;
  name: string;
  slug: string;
  chainId: number;
  chain: string;
  nativeSymbol: string;
  token: Address;
  curve: Address;
  tradable: boolean;
  priceNative: number;
  supply: number;
  lpFeeBps: number;
  treasuryBuybackBps: number;
  creator: Address;
  launchTx: Hex;
  launchBlock: number;
  /** Which read path serves trade_history for this market. */
  historySource: "indexer" | "market-index" | "rpc-logs" | string;
  buyResource: string;
  agentIdentity: AgentIdentity | null;
  staking: StakingSummary | null;
}

/** One entry of `accepts` in a 402 challenge (x402 `exact` scheme, EIP-3009). */
export interface PaymentRequirements extends Open {
  scheme: "exact" | string;
  network: string;
  /** Atomic units of the asset. USDC has 6 decimals, so "100000" is 0.10 USDC. */
  maxAmountRequired: string;
  amount?: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: { name: string; version: string; transferMethod?: string } & Open;
}

export interface PaymentChallenge extends Open {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
  resource?: { url: string; description: string } & Open;
  extensions?: Open;
  quote?: Open;
}

export interface QuoteBuyResult extends Open {
  httpStatus: number;
  quoted: boolean;
  resource: string;
  challenge: PaymentChallenge;
  next: string;
}

export interface HowToPayResult extends Open {
  protocol: string;
  settlementChain: string;
  settlementAsset: string;
  scheme: string;
  header: string;
  steps: string[];
}

export interface BuySettlement extends Open {
  symbol: string;
  chain: string;
  delivery: { success: boolean; transaction: Hex; chainId: number; to: Address; token: Address; curve: Address } & Open;
  settlement: ({ success: true; transaction: Hex; network: string; payer: Address } | { success: false; errorReason?: string }) & Open;
}

export interface BuyTokenResult extends Open {
  httpStatus: number;
  settled: boolean;
  paymentRequired?: boolean;
  challenge?: PaymentChallenge;
  result?: BuySettlement;
  next: string;
}

export interface Swap extends Open {
  txHash: Hex;
  /** The server sends "BUY" or "SELL". */
  side: "BUY" | "SELL" | string;
  amountToken: number;
  amountNative: number;
  trader: Address;
  timestamp: string;
  blockNumber: number;
}

export interface TradeHistoryResult extends Open {
  symbol: string;
  chainId: number;
  curve: Address;
  /**
   * Which read path answered: Envio (Monad, Robinhood Chain), the subgraph (Base, Arbitrum One),
   * the per-market index joined to a live log scan, or the log scan alone.
   */
  source: "envio-hyperindex" | "the-graph" | "market-index" | "rpc-logs" | string;
  /** True only when the answer reaches the market's launch block. `incompleteBecause` says why not. */
  complete: boolean;
  /** Swaps since launch. Treasury buybacks are not counted, so this can be below the curve's swapCount. */
  totalSwaps: number;
  returned: number;
  swaps: Swap[];
}

export interface CheckStakeResult extends Open {
  staking: boolean;
  symbol: string;
  chainId: number;
  stakeContract?: Address;
  kind?: string;
  address?: Address;
  /** Whole tokens, as a decimal string. */
  staked?: string;
  minStake?: string;
  active?: boolean;
  totalStaked?: string;
  stakers?: number;
}

export interface AccessMessageResult extends Open {
  message: string;
  sign: string;
  validForSeconds: number;
}

export interface AskAgentResult extends Open {
  answered: boolean;
  answer?: string;
  answeredBy?: string;
}

export interface UnsignedTransaction extends Open {
  from: Address;
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
  gas?: string;
}

export interface PrepareLaunchAttestation extends Open {
  step: "sign_attestation";
  chainId: number;
  symbol: string;
  name: string;
  deployer: Address;
  attestationMessage: string;
  validForSeconds: number;
  checks: Open;
}

export interface PrepareLaunchTransaction extends Open {
  step: "sign_and_send";
  chainId: number;
  symbol: string;
  name: string;
  deployer: Address;
  transaction: UnsignedTransaction & { gas: string };
  gasEstimate: string;
  gasSource: string;
  estimatedCostWei: string | null;
  deployerBalanceWei: string | null;
  fundsSufficient: boolean | null;
  nativeSymbol: string;
  simulation: { ok: boolean; revert: string | null };
  attestationRoot: Hex;
  metadataAnchoredTo0G: boolean;
}

export type PrepareLaunchResult = PrepareLaunchAttestation | PrepareLaunchTransaction;

export interface RegisterLaunchResult extends Open {
  registered: true;
  alreadyRegistered: boolean;
  symbol: string;
  chainId: number;
  token: Address;
  curve: Address;
  creator: Address;
  page: string;
  buyResource: string;
}

export interface PreparedTransaction extends Open {
  purpose: string;
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: string;
  gasEstimate: string | null;
  markets?: string[];
}

export interface PrepareStakeResult extends Open {
  market: string;
  chainId: number;
  stakeContract: Address;
  kind: "hub" | "dedicated" | string;
  token: Address;
  transactions: PreparedTransaction[];
  after: { staked: string; minimum: string; active: boolean };
}

export interface ClaimableMarket extends Open {
  symbol: string;
  chainId: number;
  curve: Address;
  owed: number;
  nativeSymbol: string;
  owedUsd: number | null;
}

export interface PrepareClaimResult extends Open {
  address: Address;
  claimable: ClaimableMarket[];
  transactions: PreparedTransaction[];
}

export interface ToolInfo extends Open {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Open;
  annotations?: Open;
}
