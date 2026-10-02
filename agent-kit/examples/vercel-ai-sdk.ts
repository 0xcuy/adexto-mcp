/**
 * Vercel AI SDK: ADEXTO's MCP tools as AI SDK tools, plus the kit for the signed steps.
 *
 *   npm install ai @ai-sdk/mcp @ai-sdk/openai @adexto/agent-kit viem
 *   OPENAI_API_KEY=… npx tsx examples/vercel-ai-sdk.ts
 */
import { generateText, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";

const mcp = await createMCPClient({ transport: { type: "http", url: "https://adexto.xyz/api/mcp" } });

try {
  // Read-only tools only: the model can discover, price and read history, but not spend.
  const all = await mcp.tools();
  const readOnly = Object.fromEntries(
    Object.entries(all).filter(([name]) => ["list_markets", "get_market", "quote_buy", "trade_history", "check_stake"].includes(name))
  );
  const { text } = await generateText({
    model: openai(process.env.OPENAI_MODEL ?? "gpt-5"),
    tools: readOnly,
    stopWhen: stepCountIs(8),
    prompt: "List the ADEXTO markets that can be staked, with their chain and minimum stake.",
  });
  console.log(text);
} finally {
  await mcp.close();
}

// For launch, stake, claim and paid buys, call the kit directly (launch(), stake(), claim(), buy()):
// it signs with your key after checking every transaction, which an LLM tool call cannot do.
