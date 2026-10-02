/**
 * The launch, stake and claim helpers end to end, against a local fork. No real money: the fork is
 * anvil, balances come from `anvil_setBalance`, and the site is a local build pointed at the fork.
 *
 * Needs (see the ADEXTO repository, scripts/fork-launch-test.mjs, for how to build the site):
 *   anvil --fork-url https://mainnet.base.org --chain-id 8453 --host 127.0.0.1
 *   a local ADEXTO site built with NEXT_PUBLIC_CHAIN_OVERRIDES='{"Base":{"rpcUrl":"http://127.0.0.1:8545"}}'
 *
 *   ADEXTO_FORK_SITE=http://127.0.0.1:3120 ADEXTO_FORK_RPC=http://127.0.0.1:8545 npx vitest run test/fork.test.ts
 *
 * Refuses to run unless the RPC is anvil and the site is on localhost, so it cannot send anything
 * to a real chain or register anything on the production site.
 */
import { describe, expect, it } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { AdextoToolError, claim, createAdextoClient, launch, stake } from "../src/index.js";

const SITE = process.env.ADEXTO_FORK_SITE ?? "";
const RPC = process.env.ADEXTO_FORK_RPC ?? "";
const enabled = Boolean(SITE && RPC);

const CURVE_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "minTokensOut", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "creatorOwed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

describe.skipIf(!enabled)("fork: launch, stake and claim with the kit", () => {
  // The suite body is collected even when skipped; a placeholder keeps viem from refusing an empty URL.
  const rpcUrl = RPC || "http://127.0.0.1:8545";
  const chain = { ...base, rpcUrls: { default: { http: [rpcUrl] } } };
  const transport = http(rpcUrl);
  const reader = createPublicClient({ chain, transport });
  const anvil = createTestClient({ mode: "anvil", chain, transport });
  const client = createAdextoClient({ url: `${SITE.replace(/\/+$/, "")}/api/mcp` });
  // Fresh keys: the well-known anvil accounts carry EIP-7702 sweeper code on Base mainnet, and the fork inherits it.
  const creator = privateKeyToAccount(generatePrivateKey());
  const trader = privateKeyToAccount(generatePrivateKey());
  const creatorWallet = createWalletClient({ account: creator, chain, transport });
  const traderWallet = createWalletClient({ account: trader, chain, transport });
  const symbol = `KIT${Date.now().toString(36).toUpperCase().slice(-6)}`;
  let curve: Address;

  it("is pointed at anvil and a local site", async () => {
    expect(["127.0.0.1", "localhost"]).toContain(new URL(SITE).hostname);
    expect(String(await reader.request({ method: "web3_clientVersion" as never }))).toMatch(/anvil/i);
    await anvil.setBalance({ address: creator.address, value: parseEther("10") });
    await anvil.setBalance({ address: trader.address, value: parseEther("10") });
  });

  it("launches and registers a market with the creator's own key", async () => {
    const steps: string[] = [];
    const result = await launch({
      client,
      wallet: creatorWallet,
      name: `Kit Fork ${symbol}`,
      symbol,
      description: "Rehearsal market on a local fork.",
      onStep: (e) => steps.push(e.step),
    });
    expect(steps).toEqual(["prepare", "sign_attestation", "send", "register", "done"]);
    expect(result.registration.registered).toBe(true);
    expect(result.registration.creator).toBe(creator.address);
    expect(result.gasUsed).toBeGreaterThan(1_000_000n);
    curve = result.registration.curve;
  });

  it("refuses the same ticker a second time", async () => {
    await expect(launch({ client, wallet: traderWallet, name: "Again", symbol })).rejects.toBeInstanceOf(AdextoToolError);
  });

  it("stakes after a buy, through the hub, with an exact approval", async () => {
    const block = await reader.getBlock();
    const buyHash = await traderWallet.writeContract({
      address: curve,
      abi: CURVE_ABI,
      functionName: "buy",
      args: [0n, trader.address, block.timestamp + 600n],
      value: parseEther("0.01"),
    });
    expect((await reader.waitForTransactionReceipt({ hash: buyHash })).status).toBe("success");

    const result = await stake({ client, wallet: traderWallet, symbol, amount: "100000" });
    expect(result.transactions).toHaveLength(2);
    expect(result.position.active).toBe(true);
    expect(Number(result.position.staked)).toBe(100000);
  });

  it("claims the creator fee the buy paid", async () => {
    const owedBefore = await reader.readContract({ address: curve, abi: CURVE_ABI, functionName: "creatorOwed" });
    expect(owedBefore).toBeGreaterThan(0n);
    const result = await claim({ client, wallet: creatorWallet });
    expect(result.transactions).toHaveLength(1);
    expect(result.claimed.map((m) => m.symbol)).toContain(symbol);
    expect(await reader.readContract({ address: curve, abi: CURVE_ABI, functionName: "creatorOwed" })).toBe(0n);
  });
});
