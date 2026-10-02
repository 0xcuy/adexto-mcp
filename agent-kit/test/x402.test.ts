import { afterEach, describe, expect, it } from "vitest";
import { createWalletClient, custom, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  AdextoToolError,
  BASE_USDC,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  UnsafeTransactionError,
  X402_PAYEE,
  buy,
  checkPaymentRequirements,
  createAdextoClient,
  decodePaymentHeader,
  networkChainId,
  signX402Payment,
  type PaymentRequirements,
  type X402PaymentPayload,
} from "../src/index.js";
import { startMockMcp } from "./helpers/mock-mcp.js";

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "100000",
  amount: "100000",
  resource: "https://x402.adexto.xyz/v1/x402/buy/parcel?chain=143",
  description: "Buy $PARCEL on Monad with USDC on Base.",
  mimeType: "application/json",
  payTo: X402_PAYEE,
  maxTimeoutSeconds: 300,
  asset: BASE_USDC,
  extra: { name: "USD Coin", version: "2", transferMethod: "eip3009" },
};

async function recover(payload: X402PaymentPayload, r: PaymentRequirements = requirements) {
  const a = payload.payload.authorization;
  return recoverTypedDataAddress({
    domain: { name: r.extra.name, version: r.extra.version, chainId: 8453, verifyingContract: r.asset },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: payload.payload.signature,
  });
}

describe("signX402Payment", () => {
  it("signs an EIP-3009 authorization that recovers to the payer, with the exact terms", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { header, payload } = await signX402Payment({ requirements, signer: account, nowSeconds: 1_000_000 });
    expect(await recover(payload)).toBe(account.address);
    expect(decodePaymentHeader(header)).toEqual(payload);
    expect(payload).toMatchObject({ x402Version: 2, scheme: "exact", network: "base" });
    expect(payload.payload.authorization).toMatchObject({
      from: account.address,
      to: X402_PAYEE,
      value: "100000",
      validAfter: String(1_000_000 - 60),
      validBefore: String(1_000_000 + 300),
    });
    expect(payload.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("caps the validity window at maxTimeoutSeconds and uses a fresh nonce each time", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const short = await signX402Payment({ requirements, signer: account, nowSeconds: 10_000, validForSeconds: 60 });
    const long = await signX402Payment({ requirements, signer: account, nowSeconds: 10_000, validForSeconds: 10_000 });
    expect(short.payload.payload.authorization.validBefore).toBe("10060");
    expect(long.payload.payload.authorization.validBefore).toBe("10300");
    expect(short.payload.payload.authorization.nonce).not.toBe(long.payload.payload.authorization.nonce);
  });

  it("signs with a wallet client locally, without any RPC", async () => {
    const methods: string[] = [];
    const account = privateKeyToAccount(generatePrivateKey());
    const wallet = createWalletClient({
      account,
      chain: base,
      transport: custom({ request: async ({ method }) => (methods.push(method), Promise.reject(new Error("no RPC here"))) }),
    });
    const { payload } = await signX402Payment({ requirements, signer: wallet });
    expect(await recover(payload)).toBe(account.address);
    expect(methods).toEqual([]);
  });
});

describe("checkPaymentRequirements", () => {
  it("accepts the gateway's terms", () => {
    expect(() => checkPaymentRequirements(requirements)).not.toThrow();
  });

  it.each([
    ["an amount above the cap", { maxAmountRequired: "200001" }],
    ["another payee", { payTo: "0x000000000000000000000000000000000000dEaD" }],
    ["another asset", { asset: "0x000000000000000000000000000000000000bEEF" }],
    ["another network", { network: "eip155:1" }],
    ["another scheme", { scheme: "upto" }],
    ["a non-integer amount", { maxAmountRequired: "0.1" }],
    ["a zero amount", { maxAmountRequired: "0" }],
  ])("refuses %s", (_label, patch) => {
    expect(() => checkPaymentRequirements({ ...requirements, ...patch } as PaymentRequirements)).toThrow(UnsafeTransactionError);
  });

  it("honours a raised cap", () => {
    expect(() => checkPaymentRequirements({ ...requirements, maxAmountRequired: "500000" }, { maxAmountAtomic: 500_000n })).not.toThrow();
  });

  it("maps networks to chain ids", () => {
    expect(networkChainId("base")).toBe(8453);
    expect(networkChainId("eip155:8453")).toBe(8453);
    expect(networkChainId("base-sepolia")).toBe(84532);
    expect(() => networkChainId("solana")).toThrow();
  });
});

describe("buy", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());
  const challenge = (r: PaymentRequirements = requirements) => ({
    httpStatus: 402,
    settled: false,
    paymentRequired: true,
    challenge: { x402Version: 2, error: "X-PAYMENT header is required", accepts: [r] },
    next: "Sign accepts[0]",
  });

  it("signs the challenge and calls buy_token again with it; tokens go to the signer by default", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    let recovered: string | null = null;
    const mock = await startMockMcp({
      buy_token: async (args) => {
        if (!args.xPayment) return challenge();
        recovered = await recover(decodePaymentHeader(String(args.xPayment)));
        return { httpStatus: 200, settled: true, result: { symbol: "PARCEL", delivery: { success: true } }, next: "Settled." };
      },
    });
    close = mock.close;
    const result = await buy({ client: createAdextoClient({ url: mock.url }), signer: account, symbol: "PARCEL", chainId: 143 });
    expect(result.settled).toBe(true);
    expect(recovered).toBe(account.address);
    expect(mock.calls.map((c) => [c.args.to, Boolean(c.args.xPayment)])).toEqual([
      [account.address, false],
      [account.address, true],
    ]);
    expect(result.payment.amountAtomic).toBe("100000");
  });

  it("refuses a challenge that pays someone else, and never sends a payment", async () => {
    const mock = await startMockMcp({ buy_token: () => challenge({ ...requirements, payTo: "0x000000000000000000000000000000000000dEaD" }) });
    close = mock.close;
    const signer = privateKeyToAccount(generatePrivateKey());
    await expect(buy({ client: createAdextoClient({ url: mock.url }), signer, symbol: "PARCEL" })).rejects.toBeInstanceOf(UnsafeTransactionError);
    expect(mock.calls).toHaveLength(1);
  });

  it("refuses a challenge above the cap", async () => {
    const mock = await startMockMcp({ buy_token: () => challenge({ ...requirements, maxAmountRequired: "5000000" }) });
    close = mock.close;
    const signer = privateKeyToAccount(generatePrivateKey());
    await expect(buy({ client: createAdextoClient({ url: mock.url }), signer, symbol: "PARCEL" })).rejects.toThrow(/above the cap/);
    expect(mock.calls).toHaveLength(1);
  });

  it("reports a refused payment as AdextoToolError with the gateway's reason", async () => {
    const mock = await startMockMcp({
      buy_token: (args) =>
        args.xPayment
          ? { httpStatus: 402, settled: false, paymentRequired: true, challenge: { x402Version: 2, error: "insufficient_funds", detail: "saldo 0", accepts: [requirements] }, next: "" }
          : challenge(),
    });
    close = mock.close;
    const signer = privateKeyToAccount(generatePrivateKey());
    const err = await buy({ client: createAdextoClient({ url: mock.url }), signer, symbol: "PARCEL" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdextoToolError);
    expect(err.code).toBe("insufficient_funds");
  });
});
