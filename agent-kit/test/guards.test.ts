import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import {
  CLAIM_CALLDATA,
  DEDICATED_STAKES,
  DEDICATED_STAKE_ABI,
  ERC20_APPROVE_ABI,
  FACTORY_ABI,
  HUB_STAKE_ABI,
  LAUNCH_FACTORIES,
  MULTICALL3,
  MULTICALL3_ABI,
  STAKE_HUBS,
  UnsafeTransactionError,
  assertClaimTransactions,
  assertLaunchTransaction,
  assertStakeTransactions,
  type PreparedTransaction,
  type UnsignedTransaction,
} from "../src/index.js";

const deployer: Address = "0x1111111111111111111111111111111111111111";
const other: Address = "0x2222222222222222222222222222222222222222";
const token: Address = "0x3333333333333333333333333333333333333333";
const curve: Address = "0x4444444444444444444444444444444444444444";

function launchTx(patch: Partial<UnsignedTransaction> = {}, args: { symbol?: string; identity?: Address } = {}): UnsignedTransaction {
  const data = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "deployTrinity",
    args: [
      "Test",
      args.symbol ?? "TEST",
      1_000_000_000n,
      args.identity ?? deployer,
      10n ** 18n,
      100n,
      70n,
      10n,
      `0x${"ab".repeat(32)}`,
      false,
      0n,
    ],
  });
  return { from: deployer, to: LAUNCH_FACTORIES[8453]!, data, value: "0", chainId: 8453, gas: "4000000", ...patch };
}

describe("assertLaunchTransaction", () => {
  const ctx = { chainId: 8453, deployer, symbol: "TEST" };

  it("accepts deployTrinity on the chain's factory", () => {
    expect(() => assertLaunchTransaction(launchTx(), ctx)).not.toThrow();
  });

  it.each([
    ["another chain", launchTx({ chainId: 143 })],
    ["another sender", launchTx({ from: other })],
    ["a value", launchTx({ value: "1" })],
    ["an unknown target", launchTx({ to: other })],
    ["other calldata", launchTx({ data: CLAIM_CALLDATA })],
    ["another ticker", launchTx({}, { symbol: "OTHER" })],
    ["another identity", launchTx({}, { identity: other })],
  ])("refuses %s", (_label, tx) => {
    expect(() => assertLaunchTransaction(tx, ctx)).toThrow(UnsafeTransactionError);
  });

  it("accepts a factory passed as trusted, in addition to the built-in one", () => {
    expect(() => assertLaunchTransaction(launchTx({ to: other }), { ...ctx, trusted: { factories: { 8453: [other] } } })).not.toThrow();
  });
});

describe("assertStakeTransactions", () => {
  const amountWei = parseUnits("100000", 18);
  const hub = STAKE_HUBS[8453]!;
  const approve = (spender: Address = hub, amount = amountWei): PreparedTransaction => ({
    purpose: "approve",
    chainId: 8453,
    from: deployer,
    to: token,
    data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender, amount] }),
    value: "0",
    gasEstimate: null,
  });
  const hubStake = (t: Address = token, amount = amountWei): PreparedTransaction => ({
    purpose: "stake",
    chainId: 8453,
    from: deployer,
    to: hub,
    data: encodeFunctionData({ abi: HUB_STAKE_ABI, functionName: "stake", args: [t, amount] }),
    value: "0",
    gasEstimate: null,
  });
  const ctx = { chainId: 8453, owner: deployer, token, amountWei, stakeContract: hub, kind: "hub" };

  it("accepts an exact approval to the hub and the hub stake", () => {
    expect(() => assertStakeTransactions([approve(), hubStake()], ctx)).not.toThrow();
    expect(() => assertStakeTransactions([hubStake()], ctx)).not.toThrow();
  });

  it("accepts a dedicated stake contract from the built-in list", () => {
    const sai = DEDICATED_STAKES.find((s) => s.chainId === 143)!;
    const tx: PreparedTransaction = {
      purpose: "stake",
      chainId: 143,
      from: deployer,
      to: sai.contract,
      data: encodeFunctionData({ abi: DEDICATED_STAKE_ABI, functionName: "stake", args: [amountWei] }),
      value: "0",
      gasEstimate: null,
    };
    expect(() =>
      assertStakeTransactions([tx], { chainId: 143, owner: deployer, token: sai.token, amountWei, stakeContract: sai.contract, kind: "dedicated" })
    ).not.toThrow();
  });

  it.each([
    ["an unknown stake contract", [hubStake()], { stakeContract: other }],
    ["an approval to another spender", [approve(other), hubStake()], {}],
    ["an approval for more", [approve(hub, amountWei + 1n), hubStake()], {}],
    ["a stake of another amount", [approve(), hubStake(token, amountWei - 1n)], {}],
    ["a hub stake naming another token", [approve(), hubStake(other)], {}],
    ["a third transaction", [approve(), approve(), hubStake()], {}],
    ["a value", [{ ...hubStake(), value: "5" }], {}],
    ["another sender", [{ ...hubStake(), from: other }], {}],
  ])("refuses %s", (_label, txs, patch) => {
    expect(() => assertStakeTransactions(txs as PreparedTransaction[], { ...ctx, ...patch })).toThrow(UnsafeTransactionError);
  });
});

describe("assertClaimTransactions", () => {
  const single: PreparedTransaction = { purpose: "claim", chainId: 143, from: deployer, to: curve, data: CLAIM_CALLDATA, value: "0", gasEstimate: null };
  const batch = (calls: Array<{ target: Address; allowFailure: boolean; callData: `0x${string}` }>): PreparedTransaction => ({
    purpose: "claim batch",
    chainId: 143,
    from: deployer,
    to: MULTICALL3,
    data: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [calls] }),
    value: "0",
    gasEstimate: null,
  });

  it("accepts a direct claim and a Multicall3 batch of claims, and returns the curves", () => {
    const targets = assertClaimTransactions(
      [single, batch([{ target: curve, allowFailure: false, callData: CLAIM_CALLDATA }, { target: other, allowFailure: false, callData: CLAIM_CALLDATA }])],
      { owner: deployer, chainId: 143 }
    );
    expect(targets).toEqual([[curve], [curve, other]]);
  });

  it.each([
    ["other calldata", [{ ...single, data: "0x12345678" }]],
    ["a value", [{ ...single, value: "1" }]],
    ["another sender", [{ ...single, from: other }]],
    ["another chain", [{ ...single, chainId: 1 }]],
    ["a batch with another call", [batch([{ target: curve, allowFailure: false, callData: "0xdeadbeef" }])]],
    ["a batch that tolerates failures", [batch([{ target: curve, allowFailure: true, callData: CLAIM_CALLDATA }])]],
  ])("refuses %s", (_label, txs) => {
    expect(() => assertClaimTransactions(txs as PreparedTransaction[], { owner: deployer, chainId: 143 })).toThrow(UnsafeTransactionError);
  });
});
