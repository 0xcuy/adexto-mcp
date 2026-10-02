/**
 * The helpers refuse before anything is sent. The wallet's transport records every RPC method, so
 * "nothing was sent" is checked, not assumed. The happy path with real transactions runs in
 * fork.test.ts against a local chain.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createWalletClient, custom, encodeFunctionData, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { AdextoToolError, FACTORY_ABI, LAUNCH_FACTORIES, STAKE_HUBS, UnsafeTransactionError, claim, createAdextoClient, launch, stake } from "../src/index.js";
import { startMockMcp } from "./helpers/mock-mcp.js";

function recordingWallet() {
  const methods: string[] = [];
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: custom({ request: async ({ method }) => (methods.push(method), Promise.reject(new Error(`no RPC in this test: ${method}`))) }),
  });
  return { wallet, account, methods };
}

const attestation = (deployer: Address, symbol: string) => ({
  step: "sign_attestation",
  chainId: 8453,
  symbol,
  name: "Test",
  deployer,
  attestationMessage: `ADEXTO launch attestation\nDeployer: ${deployer}\nTicker: ${symbol}\nTimestamp: ${Date.now()}`,
  validForSeconds: 1800,
  checks: {},
});

function launchStep(deployer: Address, to: Address, simulationOk = true) {
  const data = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "deployTrinity",
    args: ["Test", "TEST", 1_000_000_000n, deployer, 10n ** 18n, 100n, 70n, 10n, `0x${"ab".repeat(32)}`, false, 0n],
  });
  return {
    step: "sign_and_send",
    chainId: 8453,
    symbol: "TEST",
    name: "Test",
    deployer,
    transaction: { from: deployer, to, data, value: "0", chainId: 8453, gas: "3900000" },
    gasEstimate: "3250000",
    gasSource: "estimateGas",
    estimatedCostWei: null,
    deployerBalanceWei: null,
    fundsSufficient: null,
    nativeSymbol: "ETH",
    simulation: { ok: simulationOk, revert: simulationOk ? null : "SymbolTaken()" },
    attestationRoot: `0x${"ab".repeat(32)}`,
    metadataAnchoredTo0G: false,
  };
}

describe("launch refuses before sending", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it("a transaction to a contract that is not the ADEXTO factory", async () => {
    const { wallet, account, methods } = recordingWallet();
    const mock = await startMockMcp({
      prepare_launch: (args) => (args.attestationSignature ? launchStep(account.address, "0x000000000000000000000000000000000000dEaD") : attestation(account.address, "TEST")),
    });
    close = mock.close;
    await expect(launch({ client: createAdextoClient({ url: mock.url }), wallet, name: "Test", symbol: "TEST" })).rejects.toBeInstanceOf(UnsafeTransactionError);
    expect(methods).toEqual([]);
    // The second prepare_launch carried a real EIP-191 signature from the wallet.
    expect(String(mock.calls[1]?.args.attestationSignature)).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("an attestation that names another deployer, without signing it", async () => {
    const { wallet, methods } = recordingWallet();
    const mock = await startMockMcp({ prepare_launch: () => attestation("0x000000000000000000000000000000000000dEaD", "TEST") });
    close = mock.close;
    await expect(launch({ client: createAdextoClient({ url: mock.url }), wallet, name: "Test", symbol: "TEST" })).rejects.toThrow(/does not name this deployer/);
    expect(mock.calls).toHaveLength(1);
    expect(methods).toEqual([]);
  });

  it("a launch whose simulation reverted", async () => {
    const { wallet, account, methods } = recordingWallet();
    const mock = await startMockMcp({
      prepare_launch: (args) => (args.attestationSignature ? launchStep(account.address, LAUNCH_FACTORIES[8453]!, false) : attestation(account.address, "TEST")),
    });
    close = mock.close;
    const err = await launch({ client: createAdextoClient({ url: mock.url }), wallet, name: "Test", symbol: "test" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdextoToolError);
    expect(err.code).toBe("simulation_reverted");
    expect(methods).toEqual([]);
  });

  it("a ticker the server refuses", async () => {
    const { wallet, methods } = recordingWallet();
    const mock = await startMockMcp({ prepare_launch: () => ({ error: "symbol_unavailable", detail: "TEST is reserved" }) });
    close = mock.close;
    await expect(launch({ client: createAdextoClient({ url: mock.url }), wallet, name: "Test", symbol: "TEST" })).rejects.toMatchObject({ code: "symbol_unavailable" });
    expect(methods).toEqual([]);
  });
});

describe("stake and claim refuse before sending", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());
  const token: Address = "0x3333333333333333333333333333333333333333";

  it("stake: get_market and prepare_stake disagree on the stake contract", async () => {
    const { wallet, methods } = recordingWallet();
    const mock = await startMockMcp({
      get_market: () => ({ symbol: "TEST", chainId: 8453, token, staking: { contract: STAKE_HUBS[8453], kind: "hub" } }),
      prepare_stake: () => ({ stakeContract: "0x000000000000000000000000000000000000dEaD", token, kind: "hub", transactions: [] }),
    });
    close = mock.close;
    await expect(stake({ client: createAdextoClient({ url: mock.url }), wallet, symbol: "TEST", amount: "100000" })).rejects.toBeInstanceOf(UnsafeTransactionError);
    expect(methods).toEqual([]);
  });

  it("claim: nothing owed means no transaction and no RPC", async () => {
    const { wallet, methods } = recordingWallet();
    const mock = await startMockMcp({ prepare_claim: () => ({ address: wallet.account.address, claimable: [], transactions: [], detail: "Nothing is owed." }) });
    close = mock.close;
    expect(await claim({ client: createAdextoClient({ url: mock.url }), wallet })).toEqual({ claimed: [], transactions: [], detail: "Nothing is owed." });
    expect(methods).toEqual([]);
  });
});
