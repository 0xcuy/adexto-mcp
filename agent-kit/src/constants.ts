/**
 * Addresses the kit checks unsigned transactions against before your key signs them.
 *
 * The MCP server builds every transaction; these lists are how the kit refuses one that points
 * somewhere it should not. They are the ADEXTO deployments as of 2 October 2026. When ADEXTO ships
 * a new factory or stake contract, pass it through the `trusted*` options rather than turning the
 * checks off.
 */
import type { Address } from "./types.js";

export const DEFAULT_MCP_URL = "https://adexto.xyz/api/mcp";

export const BASE_CHAIN_ID = 8453;

/** Circle USDC on Base, the only asset the x402 gateway accepts. */
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The x402 gateway's payee (the ADEXTO protocol treasury). */
export const X402_PAYEE: Address = "0x24268Fffc119ec5550F68e80D94476fD64daE967";

/** Multicall3, used by prepare_claim to batch several claims on one chain. Same address on every chain. */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const CHAIN_NAMES: Readonly<Record<number, string>> = {
  16661: "0G",
  8453: "Base",
  42161: "Arbitrum One",
  143: "Monad",
  4663: "Robinhood Chain",
};

/** The launch factory per chain: the only `to` a prepare_launch transaction may have. */
export const LAUNCH_FACTORIES: Readonly<Record<number, Address>> = {
  16661: "0xEBbE0fB112859b57A0ad1afbeD4978e43dC96c5D",
  8453: "0xF5f904ca7763Fc6755bbCe5466a9DBd4C15c2708",
  42161: "0x79DF3671e7e7456832C84a34c2bC0DB7871C0E0E",
  143: "0x3dFcBEd7dd889F465cC9f75c430B43Ef873b6056",
  4663: "0x8e63e117E71A80Cfc10fDF375F079e2e29cd7D7D",
};

/** One stake hub per chain; it accepts every market launched through ADEXTO that has no stake contract of its own. */
export const STAKE_HUBS: Readonly<Record<number, Address>> = {
  16661: "0x440B89416A3a907a7016F20A29DA18665269A52f",
  8453: "0x2ba1EcffCD624Dc18044531F3999F0445014240D",
  42161: "0xdf8891bA9fd8e3DC2E7D0A0ccae279247cd2ddf3",
  143: "0xb89d17F7308Ac007b106EB400eB2A8CB51cf887A",
  4663: "0x05EFA7F066FcbefbE650EDd58583C107831A600B",
};

/** Markets with a stake contract of their own. */
export const DEDICATED_STAKES: ReadonlyArray<{ chainId: number; symbol: string; token: Address; contract: Address }> = [
  { chainId: 16661, symbol: "ADEXTO", token: "0xA1358C17004469C7CA5365AbafD294F9b2c11DF7", contract: "0x5b44AEA7AC49C7a6DA8f700D991852A2970b9231" },
  { chainId: 42161, symbol: "SAI", token: "0xC4b5eA97bd4e3f8Bc047fFCc74Ca9c2B6b426cb3", contract: "0x2fc2A49ea2e4357541Dda9488DCeadCD0c43B508" },
  { chainId: 4663, symbol: "SAI", token: "0x4C63223B883B3096bC1Bd24087b56951D1dAC82d", contract: "0x01b250a2db25561dB185f4628B93C72048D8bc1B" },
  { chainId: 143, symbol: "SAI", token: "0xD873B033e2dffbF7E3107CD61E7156cE23B39f20", contract: "0xAadb44692dC4c9A1759361ea973B83aa7f36700e" },
];

/** Default spending cap for one x402 buy: twice the gateway's current 0.10 USDC price. */
export const DEFAULT_MAX_PAYMENT_ATOMIC = 200_000n;

export const FACTORY_ABI = [
  {
    type: "function",
    name: "deployTrinity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "initialSupply", type: "uint256" },
      { name: "agentIdentity", type: "address" },
      { name: "virtualNative", type: "uint256" },
      { name: "swapFeeBps", type: "uint256" },
      { name: "creatorShareBps", type: "uint256" },
      { name: "treasuryShareBps", type: "uint256" },
      { name: "metadataRoot", type: "bytes32" },
      { name: "bindAgent", type: "bool" },
      { name: "agentId", type: "uint256" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
    ],
  },
] as const;

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const HUB_STAKE_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const DEDICATED_STAKE_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

export const CLAIM_ABI = [
  { type: "function", name: "claimCreatorFees", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

export const MULTICALL3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;
