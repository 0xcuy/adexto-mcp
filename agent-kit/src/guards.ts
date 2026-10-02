/**
 * Checks on every unsigned transaction the MCP server returns, run before your key signs it.
 *
 * The server builds the calldata; these functions decode it and compare it with what you asked
 * for: the right chain, your address as sender, no value, a known ADEXTO contract as target, and
 * arguments that match your request (ticker, deployer, exact stake amount). A mismatch throws
 * `UnsafeTransactionError` and nothing is sent.
 */
import { decodeFunctionData, encodeFunctionData, isAddressEqual } from "viem";
import {
  CLAIM_ABI,
  DEDICATED_STAKES,
  DEDICATED_STAKE_ABI,
  ERC20_APPROVE_ABI,
  FACTORY_ABI,
  HUB_STAKE_ABI,
  LAUNCH_FACTORIES,
  MULTICALL3,
  MULTICALL3_ABI,
  STAKE_HUBS,
} from "./constants.js";
import { UnsafeTransactionError } from "./errors.js";
import type { Address, Hex, PreparedTransaction, UnsignedTransaction } from "./types.js";

/** Extra contracts to accept, for deployments newer than this kit. Added to the built-in lists, never replacing them. */
export interface TrustedContracts {
  factories?: Partial<Record<number, Address[]>>;
  stakeContracts?: Partial<Record<number, Address[]>>;
}

export function sameAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  try {
    return Boolean(a && b) && isAddressEqual(a as Address, b as Address);
  } catch {
    return false;
  }
}

function valueOf(tx: { value?: string }): bigint {
  try {
    return BigInt(tx.value ?? "0");
  } catch {
    return -1n;
  }
}

export const CLAIM_CALLDATA: Hex = encodeFunctionData({ abi: CLAIM_ABI, functionName: "claimCreatorFees" });

// ── launch ──────────────────────────────────────────────────────────────────

export function assertLaunchTransaction(
  tx: UnsignedTransaction,
  ctx: { chainId: number; deployer: Address; symbol: string; trusted?: TrustedContracts }
): void {
  const refuse = (reason: string): never => {
    throw new UnsafeTransactionError(`Refusing to sign the launch: ${reason}`, tx);
  };
  if (Number(tx.chainId) !== ctx.chainId) refuse(`it targets chain ${tx.chainId}, not ${ctx.chainId}`);
  if (!sameAddress(tx.from, ctx.deployer)) refuse(`its sender is ${tx.from}, not ${ctx.deployer}`);
  if (valueOf(tx) !== 0n) refuse(`it sends value ${tx.value}; a launch costs gas only`);
  const factories = [LAUNCH_FACTORIES[ctx.chainId], ...(ctx.trusted?.factories?.[ctx.chainId] ?? [])].filter(Boolean) as Address[];
  if (factories.length === 0) refuse(`this kit knows no ADEXTO factory on chain ${ctx.chainId}`);
  if (!factories.some((f) => sameAddress(tx.to, f))) refuse(`it calls ${tx.to}, not the ADEXTO factory ${factories.join(" or ")}`);

  let decoded: ReturnType<typeof decodeFunctionData<typeof FACTORY_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: FACTORY_ABI, data: tx.data });
  } catch {
    return refuse("its calldata is not a deployTrinity call");
  }
  const [, symbol, , agentIdentity] = decoded.args;
  if (symbol !== ctx.symbol) refuse(`it launches ticker ${symbol}, not ${ctx.symbol}`);
  if (!sameAddress(agentIdentity, ctx.deployer)) refuse(`it records ${agentIdentity} as the market's identity, not ${ctx.deployer}`);
}

// ── stake ───────────────────────────────────────────────────────────────────

export interface StakeContext {
  chainId: number;
  owner: Address;
  token: Address;
  amountWei: bigint;
  stakeContract: Address;
  kind: string;
  trusted?: TrustedContracts;
}

export function knownStakeContract(chainId: number, token: Address, kind: string, trusted?: TrustedContracts): Address[] {
  const known: Address[] = [];
  if (kind === "hub") {
    const hub = STAKE_HUBS[chainId];
    if (hub) known.push(hub);
  } else {
    const dedicated = DEDICATED_STAKES.find((s) => s.chainId === chainId && sameAddress(s.token, token));
    if (dedicated) known.push(dedicated.contract);
  }
  return [...known, ...(trusted?.stakeContracts?.[chainId] ?? [])];
}

export function assertStakeTransactions(txs: PreparedTransaction[], ctx: StakeContext): void {
  const refuse = (reason: string, tx?: unknown): never => {
    throw new UnsafeTransactionError(`Refusing to sign the stake: ${reason}`, tx ?? txs);
  };
  const known = knownStakeContract(ctx.chainId, ctx.token, ctx.kind, ctx.trusted);
  if (!known.some((c) => sameAddress(c, ctx.stakeContract))) {
    refuse(`${ctx.stakeContract} is not a known ADEXTO stake contract for this market on chain ${ctx.chainId}`);
  }
  if (txs.length < 1 || txs.length > 2) refuse(`expected an optional approval and one stake, got ${txs.length} transactions`);

  txs.forEach((tx, i) => {
    if (Number(tx.chainId) !== ctx.chainId) refuse(`transaction ${i + 1} targets chain ${tx.chainId}, not ${ctx.chainId}`, tx);
    if (!sameAddress(tx.from, ctx.owner)) refuse(`transaction ${i + 1} is sent from ${tx.from}, not ${ctx.owner}`, tx);
    if (valueOf(tx) !== 0n) refuse(`transaction ${i + 1} sends value ${tx.value}`, tx);
    const isLast = i === txs.length - 1;
    if (!isLast) {
      // The approval: exactly the amount, to exactly the stake contract.
      if (!sameAddress(tx.to, ctx.token)) refuse(`the approval goes to ${tx.to}, not the market token ${ctx.token}`, tx);
      let approve: ReturnType<typeof decodeFunctionData<typeof ERC20_APPROVE_ABI>>;
      try {
        approve = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: tx.data });
      } catch {
        return refuse("the first transaction is not an approve call", tx);
      }
      const [spender, amount] = approve.args;
      if (!sameAddress(spender, ctx.stakeContract)) refuse(`the approval lets ${spender} spend, not the stake contract`, tx);
      if (amount !== ctx.amountWei) refuse(`the approval is for ${amount}, not exactly ${ctx.amountWei}`, tx);
      return;
    }
    if (!sameAddress(tx.to, ctx.stakeContract)) refuse(`the stake goes to ${tx.to}, not ${ctx.stakeContract}`, tx);
    if (ctx.kind === "hub") {
      let decoded: ReturnType<typeof decodeFunctionData<typeof HUB_STAKE_ABI>>;
      try {
        decoded = decodeFunctionData({ abi: HUB_STAKE_ABI, data: tx.data });
      } catch {
        return refuse("the stake transaction is not stake(token, amount)", tx);
      }
      const [token, amount] = decoded.args;
      if (!sameAddress(token, ctx.token)) refuse(`the hub stake names token ${token}, not ${ctx.token}`, tx);
      if (amount !== ctx.amountWei) refuse(`the stake is for ${amount}, not ${ctx.amountWei}`, tx);
    } else {
      let decoded: ReturnType<typeof decodeFunctionData<typeof DEDICATED_STAKE_ABI>>;
      try {
        decoded = decodeFunctionData({ abi: DEDICATED_STAKE_ABI, data: tx.data });
      } catch {
        return refuse("the stake transaction is not stake(amount)", tx);
      }
      if (decoded.args[0] !== ctx.amountWei) refuse(`the stake is for ${decoded.args[0]}, not ${ctx.amountWei}`, tx);
    }
  });
}

// ── claim ───────────────────────────────────────────────────────────────────

/**
 * Every transaction must be `claimCreatorFees()` on a curve, or one Multicall3 batch of nothing
 * but that call. `claimCreatorFees` always pays the curve's immutable creator, so even a wrong
 * curve address cannot move your funds; `claim()` additionally reads `creator()` on each curve.
 * Returns the curves the transactions call.
 */
export function assertClaimTransactions(txs: PreparedTransaction[], ctx: { owner: Address; chainId?: number }): Address[][] {
  return txs.map((tx, i) => {
    const refuse = (reason: string): never => {
      throw new UnsafeTransactionError(`Refusing to sign claim ${i + 1}: ${reason}`, tx);
    };
    if (ctx.chainId !== undefined && Number(tx.chainId) !== ctx.chainId) refuse(`it targets chain ${tx.chainId}, not ${ctx.chainId}`);
    if (!sameAddress(tx.from, ctx.owner)) refuse(`it is sent from ${tx.from}, not ${ctx.owner}`);
    if (valueOf(tx) !== 0n) refuse(`it sends value ${tx.value}`);
    if (sameAddress(tx.to, MULTICALL3)) {
      let decoded: ReturnType<typeof decodeFunctionData<typeof MULTICALL3_ABI>>;
      try {
        decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: tx.data });
      } catch {
        return refuse("the Multicall3 call is not aggregate3");
      }
      const calls = decoded.args[0];
      if (calls.length === 0) refuse("the batch is empty");
      for (const c of calls) {
        if (c.callData.toLowerCase() !== CLAIM_CALLDATA) refuse(`the batch calls something other than claimCreatorFees() on ${c.target}`);
        if (c.allowFailure) refuse("the batch allows a claim to fail silently");
      }
      return calls.map((c) => c.target as Address);
    }
    if (tx.data.toLowerCase() !== CLAIM_CALLDATA) refuse("its calldata is not claimCreatorFees()");
    return [tx.to];
  });
}
