/**
 * Stake a market's token with your own key: prepare_stake, check, send, check_stake.
 *
 * The transactions are an approval for exactly the amount (only when the allowance is short) and
 * the stake itself, against the market's own stake contract or its chain's stake hub. There is no
 * lock: unstaking works at any time. An active stake opens ask_agent for that market.
 */
import { parseUnits, type WalletClient } from "viem";
import type { AdextoClient } from "./client.js";
import { UnsafeTransactionError } from "./errors.js";
import { assertStakeTransactions, sameAddress, type TrustedContracts } from "./guards.js";
import { requireWallet, sendAndWait, type StepListener } from "./send.js";
import type { CheckStakeResult, Hex } from "./types.js";

export interface StakeOptions {
  client: AdextoClient;
  /** viem wallet client with `account` and `chain`; the market must be on `wallet.chain`. */
  wallet: WalletClient;
  symbol: string;
  /** Whole tokens, for example "10000". */
  amount: string;
  trusted?: TrustedContracts;
  onStep?: StepListener;
}

export interface StakeResult {
  transactions: Hex[];
  position: CheckStakeResult;
}

export async function stake(options: StakeOptions): Promise<StakeResult> {
  const wallet = requireWallet(options.wallet);
  const chainId = wallet.chain.id;
  const owner = wallet.account.address;
  const step = options.onStep ?? (() => undefined);

  const market = await options.client.getMarket({ symbol: options.symbol, chainId });
  const prepared = await options.client.prepareStake({ symbol: options.symbol, chainId, address: owner, amount: options.amount });
  if (!market.staking || !sameAddress(market.staking.contract, prepared.stakeContract) || !sameAddress(market.token, prepared.token)) {
    throw new UnsafeTransactionError("Refusing to sign the stake: get_market and prepare_stake disagree on the token or stake contract.", {
      market: market.staking,
      prepared: { token: prepared.token, stakeContract: prepared.stakeContract },
    });
  }
  // ADEXTO market tokens and stake contracts all use 18 decimals.
  const amountWei = parseUnits(options.amount, 18);
  assertStakeTransactions(prepared.transactions, {
    chainId,
    owner,
    token: market.token,
    amountWei,
    stakeContract: prepared.stakeContract,
    kind: String(prepared.kind),
    trusted: options.trusted,
  });

  const hashes: Hex[] = [];
  for (const tx of prepared.transactions) {
    step({ step: "send", detail: { purpose: tx.purpose, to: tx.to } });
    // In order: the stake can only be estimated once the approval is mined.
    const { hash } = await sendAndWait(wallet, { to: tx.to, data: tx.data });
    hashes.push(hash);
  }
  const position = await options.client.checkStake({ symbol: options.symbol, chainId, address: owner });
  step({ step: "done", detail: { staked: position.staked, active: position.active } });
  return { transactions: hashes, position };
}
