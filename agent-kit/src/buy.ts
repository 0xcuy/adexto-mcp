/**
 * Buy a market with USDC on Base over x402: get the 402 challenge, check it against your limits,
 * sign the EIP-3009 authorization, and call buy_token with it.
 *
 * The signer needs USDC on Base and nothing else: no gas on Base (the gateway submits the
 * authorization) and no gas or bridge on the market's chain (the curve delivers to `to`). The
 * gateway delivers first and settles after, so a failed fill is not charged.
 */
import type { AdextoClient } from "./client.js";
import { AdextoToolError } from "./errors.js";
import type { Address, BuyTokenResult } from "./types.js";
import { checkPaymentRequirements, signerAddress, signX402Payment, type KitSigner, type PaymentLimits } from "./x402.js";

export interface BuyOptions extends PaymentLimits {
  client: AdextoClient;
  /** Pays the USDC. A viem local account or a wallet client with an account. */
  signer: KitSigner;
  symbol: string;
  chainId?: number;
  /** Receives the tokens. Defaults to the signer. */
  to?: Address;
}

export interface BuyResult extends BuyTokenResult {
  payment: { amountAtomic: string; payTo: Address; nonce: string };
}

export async function buy(options: BuyOptions): Promise<BuyResult> {
  const to = options.to ?? signerAddress(options.signer);
  const first = await options.client.buyToken({ symbol: options.symbol, chainId: options.chainId, to });
  const requirements = first.challenge?.accepts?.[0];
  if (!first.paymentRequired || !first.challenge || !requirements) {
    throw new AdextoToolError("buy_token", "no_challenge", `Expected a 402 challenge, got HTTP ${first.httpStatus}.`, first);
  }
  checkPaymentRequirements(requirements, options);

  const { header, payload } = await signX402Payment({
    requirements,
    signer: options.signer,
    x402Version: first.challenge.x402Version,
  });
  const paid = await options.client.buyToken({ symbol: options.symbol, chainId: options.chainId, to, xPayment: header });
  if (paid.paymentRequired) {
    // The gateway refused the signed payment (balance, nonce, window). Nothing was charged.
    const reason = typeof paid.challenge?.error === "string" ? paid.challenge.error : "payment_refused";
    throw new AdextoToolError("buy_token", reason, String(paid.challenge?.["detail"] ?? "The gateway refused the payment."), paid);
  }
  return {
    ...paid,
    payment: { amountAtomic: requirements.maxAmountRequired, payTo: requirements.payTo, nonce: payload.payload.authorization.nonce },
  };
}
