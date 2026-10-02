import { publicActions, type Account, type Chain, type Transport, type TransactionReceipt, type WalletClient } from "viem";
import type { Address, Hex } from "./types.js";

/** A viem wallet client with both an account and a chain, the only kind the helpers send from. */
export type KitWallet = WalletClient<Transport, Chain, Account>;

/** Progress events, for logs or for an agent that reports what it is doing. */
export type StepListener = (event: { step: string; detail?: Record<string, unknown> }) => void;

export function requireWallet(wallet: WalletClient, chainId?: number): KitWallet {
  if (!wallet.account) throw new Error("The wallet client has no account; create it with `account`.");
  if (!wallet.chain) throw new Error("The wallet client has no chain; create it with `chain`.");
  if (chainId !== undefined && wallet.chain.id !== chainId) {
    throw new Error(`The wallet client is on chain ${wallet.chain.id}, but this action is on chain ${chainId}.`);
  }
  return wallet as KitWallet;
}

/** Send one value-0 transaction and wait for it. A revert throws. */
export async function sendAndWait(
  wallet: KitWallet,
  tx: { to: Address; data: Hex; gas?: bigint }
): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const hash = await wallet.sendTransaction({
    account: wallet.account,
    chain: wallet.chain,
    to: tx.to,
    data: tx.data,
    value: 0n,
    ...(tx.gas ? { gas: tx.gas } : {}),
  });
  const receipt = await wallet.extend(publicActions).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
  return { hash, receipt };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
