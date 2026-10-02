/**
 * Launch a market on Monad with your own key, then stake and claim, using only this kit.
 *
 * This sends real transactions: a launch costs about 3.2 million gas (roughly 0.7 MON in early
 * October 2026). It refuses to run without --yes.
 *
 *   PRIVATE_KEY=0x… npx tsx examples/launch-with-own-key.ts --yes MYTICKER "My Market"
 */
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { claim, createAdextoClient, launch } from "@adexto/agent-kit";

const [, , flag, symbol, name] = process.argv;
if (flag !== "--yes" || !symbol || !name) {
  console.error('Usage: PRIVATE_KEY=0x… npx tsx examples/launch-with-own-key.ts --yes TICKER "Market name"');
  process.exit(1);
}

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: monad, transport: http() });
const client = createAdextoClient();

const launched = await launch({
  client,
  wallet,
  name,
  symbol,
  description: "Launched by an agent with its own key.",
  onStep: ({ step, detail }) => console.log(step, detail ?? ""),
});
console.log("market page:", launched.registration.page);

// Later, once people trade it: collect the 0.70% creator fee owed on this chain.
const claimed = await claim({ client, wallet });
console.log(claimed.transactions.length ? `claimed in ${claimed.transactions.join(", ")}` : claimed.detail);
