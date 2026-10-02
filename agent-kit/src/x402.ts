/**
 * x402 `exact` payments on Base: an EIP-3009 `TransferWithAuthorization` signed by the payer,
 * base64-encoded for the `X-PAYMENT` header (or the `xPayment` argument of buy_token).
 *
 * Signing moves nothing by itself. The gateway submits the authorization only after it has
 * delivered, and USDC enforces the amount, the recipient, the validity window and the one-time
 * nonce that were signed. `checkPaymentRequirements` is the part that protects you before you sign:
 * it refuses a challenge that asks for more than your cap, in another asset, or for another payee.
 */
import { isAddressEqual, type LocalAccount, type WalletClient } from "viem";
import { BASE_CHAIN_ID, BASE_USDC, DEFAULT_MAX_PAYMENT_ATOMIC, X402_PAYEE } from "./constants.js";
import { UnsafeTransactionError } from "./errors.js";
import type { Address, Hex, PaymentRequirements } from "./types.js";

/** A viem local account (`privateKeyToAccount`) or a wallet client that has an account. */
export type KitSigner = LocalAccount | WalletClient;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface X402Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: X402Authorization };
}

function isWalletClient(signer: KitSigner): signer is WalletClient {
  return typeof (signer as WalletClient).request === "function" && "transport" in signer;
}

export function signerAddress(signer: KitSigner): Address {
  if (isWalletClient(signer)) {
    if (!signer.account) throw new Error("The wallet client has no account; create it with `account`.");
    return signer.account.address;
  }
  return signer.address;
}

/** "base" → 8453, "base-sepolia" → 84532, "eip155:<id>" → id. */
export function networkChainId(network: string): number {
  if (network === "base") return BASE_CHAIN_ID;
  if (network === "base-sepolia") return 84532;
  const m = /^eip155:(\d+)$/.exec(network);
  if (m) return Number(m[1]);
  throw new UnsafeTransactionError(`Unknown x402 network "${network}".`);
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  try {
    return Boolean(a && b) && isAddressEqual(a as Address, b as Address);
  } catch {
    return false;
  }
}

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodePaymentHeader(header: string): X402PaymentPayload {
  const binary = atob(header);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as X402PaymentPayload;
}

export interface PaymentLimits {
  /** Refuse any challenge above this many atomic units. Defaults to 200000 (0.20 USDC). */
  maxAmountAtomic?: bigint;
  /** Expected payee. Defaults to the ADEXTO gateway's treasury. */
  expectedPayTo?: Address;
  /** Expected asset. Defaults to USDC on Base. */
  expectedAsset?: Address;
  /** Expected chain of the payment. Defaults to Base (8453). */
  expectedChainId?: number;
}

/** Throws `UnsafeTransactionError` unless the challenge asks for what you agreed to pay. */
export function checkPaymentRequirements(requirements: PaymentRequirements, limits: PaymentLimits = {}): void {
  const max = limits.maxAmountAtomic ?? DEFAULT_MAX_PAYMENT_ATOMIC;
  const payTo = limits.expectedPayTo ?? X402_PAYEE;
  const asset = limits.expectedAsset ?? BASE_USDC;
  const chainId = limits.expectedChainId ?? BASE_CHAIN_ID;
  const refuse = (reason: string) => {
    throw new UnsafeTransactionError(`Refusing to sign the payment: ${reason}`, requirements);
  };
  if (requirements.scheme !== "exact") refuse(`scheme "${requirements.scheme}" is not "exact"`);
  if (networkChainId(requirements.network) !== chainId) refuse(`it settles on ${requirements.network}, not chain ${chainId}`);
  if (!sameAddress(requirements.asset, asset)) refuse(`it asks for asset ${requirements.asset}, not ${asset}`);
  if (!sameAddress(requirements.payTo, payTo)) refuse(`it pays ${requirements.payTo}, not ${payTo}`);
  let amount: bigint;
  try {
    amount = BigInt(requirements.maxAmountRequired);
  } catch {
    return refuse(`amount "${requirements.maxAmountRequired}" is not an integer`);
  }
  if (amount <= 0n) refuse("the amount is not positive");
  if (amount > max) refuse(`it asks for ${amount} atomic units, above the cap of ${max}`);
}

export interface SignX402PaymentOptions {
  requirements: PaymentRequirements;
  signer: KitSigner;
  /** Echoed in the payload. Take it from the challenge; defaults to 2. */
  x402Version?: number;
  /** Seconds the authorization stays valid, at most `requirements.maxTimeoutSeconds`. */
  validForSeconds?: number;
  /** Clock override for tests. */
  nowSeconds?: number;
  /** Override for tests; a fresh random bytes32 otherwise. */
  nonce?: Hex;
}

/**
 * Sign `requirements` as an EIP-3009 authorization and return the `X-PAYMENT` header value.
 * It does not check the requirements: call `checkPaymentRequirements` first, as `buy()` does.
 */
export async function signX402Payment(options: SignX402PaymentOptions): Promise<{ header: string; payload: X402PaymentPayload }> {
  const r = options.requirements;
  const from = signerAddress(options.signer);
  const now = BigInt(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  const window = BigInt(Math.max(1, Math.min(options.validForSeconds ?? r.maxTimeoutSeconds ?? 300, r.maxTimeoutSeconds || 300)));
  const authorization: X402Authorization = {
    from,
    to: r.payTo,
    value: BigInt(r.maxAmountRequired).toString(),
    // One minute back: USDC requires now > validAfter strictly, so `now` itself fails in the same second.
    validAfter: (now - 60n).toString(),
    validBefore: (now + window).toString(),
    nonce: options.nonce ?? randomNonce(),
  };
  const typedData = {
    domain: { name: r.extra.name, version: r.extra.version, chainId: networkChainId(r.network), verifyingContract: r.asset },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  };
  const signer = options.signer;
  const signature = isWalletClient(signer)
    ? await signer.signTypedData({ ...typedData, account: signer.account! })
    : await signer.signTypedData(typedData);

  const payload: X402PaymentPayload = {
    x402Version: options.x402Version ?? 2,
    scheme: "exact",
    network: r.network,
    payload: { signature, authorization },
  };
  return { header: toBase64(JSON.stringify(payload)), payload };
}
