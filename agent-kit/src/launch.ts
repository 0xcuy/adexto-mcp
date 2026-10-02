/**
 * Launch a market with your own key: prepare_launch twice, sign, send, register_launch.
 *
 * The server never holds the key. It returns an attestation message to sign, then the unsigned
 * `deployTrinity` transaction, which this function checks (`assertLaunchTransaction`) before the
 * wallet signs it. Gas is the only cost: about 3.2 million gas, which is roughly $0.02 on Monad and
 * $0.10 on Base at early-October 2026 prices.
 */
import type { WalletClient } from "viem";
import type { AdextoClient } from "./client.js";
import { AdextoToolError, UnsafeTransactionError } from "./errors.js";
import { assertLaunchTransaction, type TrustedContracts } from "./guards.js";
import { requireWallet, sendAndWait, sleep, type StepListener } from "./send.js";
import type { Hex, LaunchMetadata, PrepareLaunchResult, RegisterLaunchResult } from "./types.js";

export interface LaunchOptions extends LaunchMetadata {
  client: AdextoClient;
  /** viem wallet client with `account` and `chain`; the launch goes to `wallet.chain`. */
  wallet: WalletClient;
  name: string;
  /** Ticker, 2 to 12 characters A-Z or 0-9. Permanent on chain. */
  symbol: string;
  /** ERC-8004 agent id on this chain, owned by the wallet, to bind to the token. */
  agentId?: string;
  /** Send even when the server's simulation reverted. Off by default; a reverted simulation almost always means a reverted launch. */
  allowFailedSimulation?: boolean;
  /** Contracts newer than this kit's built-in list. */
  trusted?: TrustedContracts;
  /** register_launch retries while the server's RPC has not seen the receipt yet. Defaults to 10, 3 s apart. */
  registerRetries?: number;
  registerRetryMs?: number;
  onStep?: StepListener;
}

export interface LaunchResult {
  symbol: string;
  chainId: number;
  txHash: Hex;
  gasUsed: bigint;
  registration: RegisterLaunchResult;
}

export async function launch(options: LaunchOptions): Promise<LaunchResult> {
  const wallet = requireWallet(options.wallet);
  const chainId = wallet.chain.id;
  const deployer = wallet.account.address;
  const symbol = options.symbol.trim().toUpperCase();
  const step = options.onStep ?? (() => undefined);

  const base = {
    chainId,
    name: options.name,
    symbol,
    deployer,
    agentId: options.agentId,
    description: options.description,
    website: options.website,
    x: options.x,
    github: options.github,
    docs: options.docs,
    image: options.image,
    category: options.category,
  };

  step({ step: "prepare", detail: { chainId, symbol, deployer } });
  const first: PrepareLaunchResult = await options.client.prepareLaunch(base);
  if (first.step !== "sign_attestation") {
    throw new AdextoToolError("prepare_launch", "unexpected_step", `Expected sign_attestation, got ${String(first.step)}.`, first);
  }
  if (!first.attestationMessage.includes(`Deployer: ${deployer}`) || !first.attestationMessage.includes(`Ticker: ${symbol}`)) {
    throw new UnsafeTransactionError("Refusing to sign the attestation: it does not name this deployer and ticker.", first);
  }

  step({ step: "sign_attestation" });
  const attestationSignature = await wallet.signMessage({ account: wallet.account, message: first.attestationMessage });

  const second: PrepareLaunchResult = await options.client.prepareLaunch({
    ...base,
    attestationMessage: first.attestationMessage,
    attestationSignature,
  });
  if (second.step !== "sign_and_send") {
    throw new AdextoToolError("prepare_launch", "unexpected_step", `Expected sign_and_send, got ${String(second.step)}.`, second);
  }
  if (!second.simulation.ok && !options.allowFailedSimulation) {
    throw new AdextoToolError("prepare_launch", "simulation_reverted", second.simulation.revert ?? "The launch simulation reverted.", second);
  }
  assertLaunchTransaction(second.transaction, { chainId, deployer, symbol, trusted: options.trusted });

  step({ step: "send", detail: { to: second.transaction.to, gas: second.transaction.gas, estimatedCostWei: second.estimatedCostWei } });
  const { hash, receipt } = await sendAndWait(wallet, {
    to: second.transaction.to,
    data: second.transaction.data,
    gas: BigInt(second.transaction.gas),
  });

  step({ step: "register", detail: { txHash: hash } });
  const retries = options.registerRetries ?? 10;
  const delay = options.registerRetryMs ?? 3_000;
  for (let attempt = 0; ; attempt++) {
    try {
      const registration = await options.client.registerLaunch({ chainId, txHash: hash });
      step({ step: "done", detail: { token: registration.token, curve: registration.curve, page: registration.page } });
      return { symbol, chainId, txHash: hash, gasUsed: receipt.gasUsed, registration };
    } catch (error) {
      if (error instanceof AdextoToolError && error.code === "not_mined_yet" && attempt < retries) {
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}
