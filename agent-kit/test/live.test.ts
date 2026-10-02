/**
 * Read-only checks against the production server. Nothing here spends, signs a transaction, or
 * writes: no prepare_launch second step (it anchors metadata), no paid buy, no pay_and_buy.
 *
 * Also checks this kit's built-in addresses against what production serves, so a stale list fails
 * here instead of refusing a real stake later.
 *
 *   ADEXTO_LIVE=1 npx vitest run test/live.test.ts
 */
import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  AdextoToolError,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  checkPaymentRequirements,
  createAdextoClient,
  knownStakeContract,
  sameAddress,
  signX402Payment,
} from "../src/index.js";

const live = Boolean(process.env.ADEXTO_LIVE);
const client = createAdextoClient({ url: process.env.ADEXTO_MCP_URL });
const stranger = privateKeyToAccount(generatePrivateKey());

describe.skipIf(!live)("production, read-only", () => {
  it("lists the fourteen tools", async () => {
    const names = (await client.listTools()).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "access_message",
        "ask_agent",
        "buy_token",
        "check_stake",
        "get_market",
        "how_to_pay",
        "list_markets",
        "pay_and_buy",
        "prepare_claim",
        "prepare_launch",
        "prepare_stake",
        "quote_buy",
        "register_launch",
        "trade_history",
      ].sort()
    );
  });

  it("lists markets, and every stake contract production serves is in the kit's list", async () => {
    const { markets, count } = await client.listMarkets();
    expect(count).toBeGreaterThan(0);
    expect(markets.length).toBe(count);
    for (const m of markets) {
      expect(m.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
      const detail = await client.getMarket({ symbol: m.symbol, chainId: m.chainId });
      expect(detail.curve).toBe(m.curve);
      if (detail.staking) {
        const known = knownStakeContract(detail.chainId, detail.token, String(detail.staking.kind));
        expect(known.some((c) => sameAddress(c, detail.staking!.contract)), `${m.symbol}@${m.chainId} ${detail.staking.contract}`).toBe(true);
      }
    }
  });

  it("quotes a buy whose terms pass the kit's default limits, and signs them without sending", async () => {
    const markets = (await client.listMarkets()).markets.filter((m) => m.tradable);
    const pick = markets.find((m) => m.symbol === "PARCEL") ?? markets[0]!;
    const quote = await client.quoteBuy({ symbol: pick.symbol, chainId: pick.chainId });
    expect(quote.quoted).toBe(true);
    const req = quote.challenge.accepts[0]!;
    expect(() => checkPaymentRequirements(req)).not.toThrow();
    const { payload } = await signX402Payment({ requirements: req, signer: stranger, x402Version: quote.challenge.x402Version });
    const a = payload.payload.authorization;
    const recovered = await recoverTypedDataAddress({
      domain: { name: req.extra.name, version: req.extra.version, chainId: 8453, verifyingContract: req.asset },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
      signature: payload.payload.signature,
    });
    expect(recovered).toBe(stranger.address);
  });

  it("answers the other free tools", async () => {
    expect((await client.howToPay()).header).toBe("X-PAYMENT");
    const parcel = { symbol: "PARCEL", chainId: 143 };
    const history = await client.tradeHistory({ ...parcel, limit: 2 });
    expect(history.swaps.length).toBeLessThanOrEqual(2);
    const position = await client.checkStake({ ...parcel, address: stranger.address });
    expect(position.staking).toBe(true);
    expect(position.active).toBe(false);
    const access = await client.accessMessage({ ...parcel, address: stranger.address });
    expect(access.message).toContain(stranger.address);
    const owed = await client.prepareClaim({ address: stranger.address });
    expect(owed.transactions).toEqual([]);
  });

  it("refuses what it should, as AdextoToolError codes", async () => {
    await expect(client.getMarket({ symbol: "NOT_A_MARKET_XYZ" })).rejects.toMatchObject({ code: "unknown_market" });
    const err = await client.prepareStake({ symbol: "PARCEL", chainId: 143, address: stranger.address, amount: "100000" }).catch((e) => e);
    expect(err).toBeInstanceOf(AdextoToolError);
    expect(err.code).toBe("insufficient_balance");
  });

  it("prepare_launch step one returns the attestation to sign (no anchoring, nothing written)", async () => {
    const first = await client.prepareLaunch({ chainId: 143, name: "Kit Live Check", symbol: "KITLIVE", deployer: stranger.address });
    expect(first.step).toBe("sign_attestation");
    if (first.step === "sign_attestation") expect(first.attestationMessage).toContain(`Deployer: ${stranger.address}`);
  });
});
