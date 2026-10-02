/**
 * OpenAI Agents SDK: the model reads ADEXTO through MCP; anything that needs a signature goes
 * through a local function tool that signs with your key. The model never sees the key.
 *
 *   npm install @openai/agents zod @adexto/agent-kit viem
 *   OPENAI_API_KEY=… PRIVATE_KEY=0x… npx tsx examples/openai-agents.ts
 */
import { Agent, MCPServerStreamableHttp, run, tool } from "@openai/agents";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { buy, createAdextoClient } from "@adexto/agent-kit";

const adexto = new MCPServerStreamableHttp({ url: "https://adexto.xyz/api/mcp", name: "adexto" });
const client = createAdextoClient();
const payer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

// The one paid step. The kit checks the 402 terms (USDC on Base, ADEXTO's payee, at most
// 0.20 USDC by default) before it signs, so the model can choose what to buy but not what to pay.
const buyWithMyWallet = tool({
  name: "buy_with_my_wallet",
  description: "Buy one ADEXTO market for about 0.10 USDC on Base, paid from the operator's own wallet.",
  parameters: z.object({ symbol: z.string(), chainId: z.number().int().nullable() }),
  execute: async ({ symbol, chainId }) => {
    const result = await buy({ client, signer: payer, symbol, chainId: chainId ?? undefined });
    return JSON.stringify({ settled: result.settled, delivery: result.result?.delivery, settlement: result.result?.settlement });
  },
});

const agent = new Agent({
  name: "ADEXTO trader",
  instructions:
    "Use the adexto MCP tools to find and price markets (list_markets, get_market, quote_buy, trade_history). " +
    "Only call buy_with_my_wallet when the user asks you to buy.",
  mcpServers: [adexto],
  tools: [buyWithMyWallet],
});

try {
  await adexto.connect();
  const result = await run(agent, "Which ADEXTO markets trade on Monad, and what does PARCEL cost right now?");
  console.log(result.finalOutput);
} finally {
  await adexto.close();
}
