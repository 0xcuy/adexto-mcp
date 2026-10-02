/**
 * Collect the creator fee your markets owe you on the wallet's chain: prepare_claim, check, send.
 *
 * `claimCreatorFees()` pays the curve's immutable creator whoever sends it. Before signing, this
 * function decodes each transaction and reads `creator()` on every curve it calls, so it only
 * spends gas on curves that pay this wallet.
 */
import { publicActions, type WalletClient } from "viem";
import type { AdextoClient } from "./client.js";
import { UnsafeTransactionError } from "./errors.js";
import { assertClaimTransactions, sameAddress } from "./guards.js";
import { requireWallet, sendAndWait, type StepListener } from "./send.js";
import type { ClaimableMarket, Hex } from "./types.js";

const CREATOR_ABI = [{ type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }] as const;

export interface ClaimOptions {
  client: AdextoClient;
  /** viem wallet client with `account` and `chain`; claims on `wallet.chain` only. */
  wallet: WalletClient;
  onStep?: StepListener;
}

export interface ClaimResult {
  claimed: ClaimableMarket[];
  transactions: Hex[];
  /** Set when nothing was owed. */
  detail?: string;
}

export async function claim(options: ClaimOptions): Promise<ClaimResult> {
  const wallet = requireWallet(options.wallet);
  const chainId = wallet.chain.id;
  const owner = wallet.account.address;
  const step = options.onStep ?? (() => undefined);

  const prepared = await options.client.prepareClaim({ address: owner, chainId });
  if (prepared.transactions.length === 0) {
    return { claimed: [], transactions: [], detail: typeof prepared.detail === "string" ? prepared.detail : "Nothing is owed." };
  }
  const curvesPerTx = assertClaimTransactions(prepared.transactions, { owner, chainId });

  const reader = wallet.extend(publicActions);
  for (const curve of curvesPerTx.flat()) {
    const creator = await reader.readContract({ address: curve, abi: CREATOR_ABI, functionName: "creator" });
    if (!sameAddress(creator, owner)) {
      throw new UnsafeTransactionError(`Refusing to sign the claim: curve ${curve} pays ${creator}, not ${owner}.`);
    }
  }

  const hashes: Hex[] = [];
  for (const tx of prepared.transactions) {
    step({ step: "send", detail: { purpose: tx.purpose, to: tx.to } });
    const { hash } = await sendAndWait(wallet, { to: tx.to, data: tx.data });
    hashes.push(hash);
  }
  step({ step: "done", detail: { transactions: hashes.length } });
  return { claimed: prepared.claimable.filter((m) => m.chainId === chainId), transactions: hashes };
}
