# @adexto/agent-kit

A typed client for the [ADEXTO](https://adexto.xyz) MCP server, an x402 payment signer, and
`launch`, `stake`, `claim` and `buy` helpers that sign with your own key.

The ADEXTO MCP server (`https://adexto.xyz/api/mcp`) prepares unsigned transactions and never holds
a key. This kit is the other half: it signs them locally, after checking that each one is what you
asked for.

> Status: 0.1.0, not on npm yet.

## Install

Until it is published, build it from this repository:

```sh
git clone https://github.com/0xcuy/adexto-mcp.git
cd adexto-mcp/agent-kit && npm ci && npm run build
cd /path/to/your/project && npm install /path/to/adexto-mcp/agent-kit viem
```

`viem` is a peer dependency, so your wallet client and the kit share one copy.

## Read

```ts
import { createAdextoClient } from "@adexto/agent-kit";

const adexto = createAdextoClient(); // https://adexto.xyz/api/mcp
const { markets } = await adexto.listMarkets();
const parcel = await adexto.getMarket({ symbol: "PARCEL", chainId: 143 });
const quote = await adexto.quoteBuy({ symbol: "PARCEL", chainId: 143 });
```

All fourteen tools have a typed method: `listMarkets`, `getMarket`, `quoteBuy`, `howToPay`,
`buyToken`, `payAndBuy`, `tradeHistory`, `checkStake`, `accessMessage`, `askAgent`,
`prepareLaunch`, `registerLaunch`, `prepareStake`, `prepareClaim`. A refusal such as
`unknown_market` throws `AdextoToolError` with the tool's code and its whole answer in `data`.
`callTool(name, args)` returns refusals as values instead.

## Launch, stake and claim with your key

```ts
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { claim, createAdextoClient, launch, stake } from "@adexto/agent-kit";

const adexto = createAdextoClient();
const wallet = createWalletClient({ account: privateKeyToAccount(KEY), chain: monad, transport: http() });

const { registration } = await launch({ client: adexto, wallet, name: "My Market", symbol: "MYMKT" });
await stake({ client: adexto, wallet, symbol: "MYMKT", amount: "10000" });
await claim({ client: adexto, wallet });
```

`launch` calls `prepare_launch` twice (the second time with your signed attestation), sends the
`deployTrinity` transaction, waits for it, and calls `register_launch`. Gas is the only cost:
about 3.2 million gas per launch.

## Buy over x402

```ts
import { buy } from "@adexto/agent-kit";

const result = await buy({ client: adexto, signer: privateKeyToAccount(KEY), symbol: "PARCEL", chainId: 143 });
```

The signer needs USDC on Base and nothing else. The gateway delivers the token on the market's
chain first and settles the USDC after, so a failed fill is not charged.

## What the kit checks before your key signs

| Action | Refused unless |
|---|---|
| Launch | The transaction is `deployTrinity` on the chain's ADEXTO factory, from you, with value 0, for the ticker you asked for, recording you as the market's identity. The attestation names you and the ticker. The server's simulation did not revert. |
| Stake | The stake contract is the chain's ADEXTO stake hub or the market's own stake contract, the approval is for exactly your amount to exactly that contract, and the stake is for exactly your amount. |
| Claim | Every call is `claimCreatorFees()` (directly or in one Multicall3 batch), with value 0, on curves whose `creator()` is you. |
| Buy | The 402 terms are the `exact` scheme, USDC on Base, ADEXTO's payee, and at most `maxAmountAtomic` (0.20 USDC by default). |

A refusal throws `UnsafeTransactionError` and nothing is sent. The built-in addresses are the
ADEXTO deployments as of 6 October 2026, on all six chains including Arc; pass newer ones through
the `trusted` option instead of turning the checks off.

**On Arc** the gas is paid in USDC (18 decimals at the native level), so a wallet that holds USDC on
Arc can launch, stake and claim with nothing else. viem's `arc` chain ships without a default RPC URL,
so pass one to the transport: `http("https://rpc.mainnet.arc.io")`. The Arc factory has the same address
as the Robinhood Chain factory; the kit tells them apart by chain id.

## Tests

```sh
npm test                    # unit tests, no network
npm run test:live           # read-only checks against production; spends and writes nothing
ADEXTO_FORK_SITE=http://127.0.0.1:3120 ADEXTO_FORK_RPC=http://127.0.0.1:8545 npm run test:fork
```

The fork suite launches, buys, stakes and claims on a local anvil fork of Base, against a local
ADEXTO site built for that fork. It refuses to run unless the RPC is anvil and the site is local.

## Examples

- [Claude Code](./examples/claude-code.md)
- [OpenAI Agents SDK](./examples/openai-agents.ts)
- [Vercel AI SDK](./examples/vercel-ai-sdk.ts)
- [Launch with your own key](./examples/launch-with-own-key.ts)

## License

Business Source License 1.1 ([LICENSE](LICENSE)). You may use the kit in production to build agents and apps on
ADEXTO. You may not use it to run a competing token launchpad, bonding curve platform, or token launch or trading
service for AI agents. On 2030-09-29 it becomes MIT.
