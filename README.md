<p align="center"><img src="assets/adexto-400.png" width="112" height="112" alt="ADEXTO logo"></p>

# ADEXTO MCP

The remote MCP server for [ADEXTO](https://adexto.xyz) bonding-curve token markets on 0G, Base, Arbitrum One,
Monad and Robinhood Chain, plus a TypeScript kit that signs its transactions with your own key.

- **Endpoint:** `https://adexto.xyz/api/mcp`. Streamable HTTP, no account, no API key.
- **14 tools:** list and price markets, read trade history, buy with USDC on Base over x402, read and open stakes,
  and launch, stake and claim with your own key. Full reference: [TOOLS.md](TOOLS.md).
- **No custody:** the server never holds your key. Launch, stake and claim tools return unsigned transactions.
- **Registry:** `xyz.adexto/mcp` in the
  [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=xyz.adexto/mcp).

## Connect

**Claude Code**

```sh
claude mcp add --transport http adexto https://adexto.xyz/api/mcp
```

**Cursor** (`~/.cursor/mcp.json`)

```json
{ "mcpServers": { "adexto": { "url": "https://adexto.xyz/api/mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "adexto": { "type": "http", "url": "https://adexto.xyz/api/mcp" } } }
```

**Cline** (see [llms-install.md](llms-install.md))

```json
{ "mcpServers": { "adexto": { "type": "streamableHttp", "url": "https://adexto.xyz/api/mcp" } } }
```

**Any client, or plain HTTP**

```sh
curl -s https://adexto.xyz/api/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_markets","arguments":{}}}'
```

The server is stateless. A client may call `tools/list` and `tools/call` directly, without an `initialize` round
trip.

## Tools

| Tool | What it does | Cost |
|---|---|---|
| `list_markets` | Every market on every chain, with ticker, chain, curve and price | free |
| `get_market` | One market in detail: fees, supply, creator, ERC-8004 agent, how to stake it | free |
| `quote_buy` | The x402 quote for a buy, without paying | free |
| `how_to_pay` | The steps from a 402 challenge to a settled buy | free |
| `buy_token` | Buy a market with USDC on Base; delivered on the market's own chain | 0.10 USDC per buy today |
| `pay_and_buy` | Operator-signed, capped demo purchase (needs an operator key header) | operator only |
| `trade_history` | Every swap on a market, and whether the answer reaches the launch block | free |
| `check_stake` | A wallet's stake in a market, read from the stake contract | free |
| `access_message` | The message to sign before `ask_agent` | free |
| `ask_agent` | Ask the market's agent, for an address with an active stake | free |
| `prepare_launch` | Unsigned launch transaction for your key, after a signed attestation | free; you pay gas to send it |
| `register_launch` | List a mined launch on ADEXTO | free |
| `prepare_stake` | Unsigned approval and stake transactions | free; you pay gas to send them |
| `prepare_claim` | Unsigned creator-fee claims | free; you pay gas to send them |

Every tool declares an output schema and returns `structuredContent` alongside the JSON text. A refusal such as
`unknown_market` or `below_minimum` is an ordinary answer with an `error` code, and nothing is spent when a tool
refuses.

## Paying over x402

`buy_token` first answers with an HTTP 402 challenge. Sign the EIP-3009 `TransferWithAuthorization` described in
`accepts[0]` (USDC on Base, exact amount, ADEXTO's payee), base64-encode the x402 payload, and call `buy_token`
again with it as `xPayment`. The curve on the market's own chain then sends the tokens to your address. You need
USDC on Base and nothing else: no gas on Base, no gas on the destination chain, no bridge.

Delivery runs before the charge, so a failed fill is not charged. The same gateway is also reachable as plain
HTTP at `https://x402.adexto.xyz` ([OpenAPI](https://x402.adexto.xyz/openapi.json)).

## Launch, stake and claim with your own key

An LLM cannot sign, so the transaction tools stop at an unsigned transaction. The [agent kit](agent-kit/) in this
repository finishes the job locally:

```ts
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { claim, createAdextoClient, launch, stake } from "@adexto/agent-kit";

const adexto = createAdextoClient();
const wallet = createWalletClient({ account: privateKeyToAccount(KEY), chain: monad, transport: http() });

await launch({ client: adexto, wallet, name: "My Market", symbol: "MYMKT" });
await stake({ client: adexto, wallet, symbol: "MYMKT", amount: "10000" });
await claim({ client: adexto, wallet });
```

Before your key signs anything, the kit decodes each transaction and refuses one that does not match the request:
an unknown factory or stake contract, another sender, a non-zero value, an approval for anything but the exact
stake amount, or a 402 challenge above your spending cap or for another payee. See
[agent-kit/README.md](agent-kit/README.md).

The kit is not on npm yet. To use it now, clone this repository, run `npm ci && npm run build` in `agent-kit/`,
then `npm install /path/to/adexto-mcp/agent-kit` in your project.

## Repository

| Path | What |
|---|---|
| [`TOOLS.md`](TOOLS.md) | Tool reference, generated from the live server by `scripts/sync-tools.mjs` |
| [`llms-install.md`](llms-install.md) | Setup instructions for Cline and other agents |
| [`agent-kit/`](agent-kit/) | `@adexto/agent-kit`: typed client, x402 signer, launch, stake, claim and buy helpers |
| [`assets/`](assets/) | Logo, 400×400 and 512×512 PNG |

The server itself runs inside the ADEXTO app, because it reads the app's market registry and calls its launch
stage directly. Its source is
[`src/app/api/[transport]/route.ts`](https://github.com/0xcuy/adexto/blob/main/src/app/api/%5Btransport%5D/route.ts)
in [0xcuy/adexto](https://github.com/0xcuy/adexto).

## Security

Report vulnerabilities privately as described in the main repository's
[security policy](https://github.com/0xcuy/adexto/blob/main/SECURITY.md). The MCP server, including
`pay_and_buy`, is in its scope. Please do not open a public issue for a vulnerability.

## License

Business Source License 1.1 ([LICENSE](LICENSE)), the same license as the ADEXTO app, contracts and server
source in [0xcuy/adexto](https://github.com/0xcuy/adexto). You may use the documentation and the agent kit in
production to build agents, apps and integrations on ADEXTO. You may not use them to run a competing token
launchpad, bonding curve platform, or token launch or trading service for AI agents. On 2030-09-29 they become
MIT.

The ADEXTO name and logo are not licensed by this repository. Use them only to refer to ADEXTO.
