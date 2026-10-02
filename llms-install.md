# Installing the ADEXTO MCP server

ADEXTO is a hosted remote MCP server. There is nothing to install or run locally, and no API key.

## Cline

Add this to Cline's MCP settings (MCP Servers → Configure → Configure MCP Servers):

```json
{
  "mcpServers": {
    "adexto": {
      "type": "streamableHttp",
      "url": "https://adexto.xyz/api/mcp"
    }
  }
}
```

`"type": "streamableHttp"` is required: without it Cline falls back to the legacy SSE transport.

With the Cline CLI, one command does the same:

```sh
cline mcp install adexto https://adexto.xyz/api/mcp --transport streamableHttp --yes
```

## Other clients

Use the URL `https://adexto.xyz/api/mcp` with the Streamable HTTP transport. Examples for Claude Code, Cursor and
VS Code are in [README.md](README.md#connect).

## Check that it works

Call `list_markets`. It is free and returns every market with its chain and curve.

Every tool except `buy_token` and `pay_and_buy` is free. `buy_token` returns an HTTP 402 quote first; paying it
needs a wallet that signs an EIP-3009 USDC authorization on Base, which an agent cannot do by itself.
`prepare_launch`, `prepare_stake` and `prepare_claim` return unsigned transactions for your own wallet to sign; the
[agent kit](agent-kit/) signs them locally after checking them.
