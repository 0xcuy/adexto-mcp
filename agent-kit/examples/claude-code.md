# Claude Code

Add the server once:

```sh
claude mcp add --transport http adexto https://adexto.xyz/api/mcp
```

Claude can then list, price and read every ADEXTO market, check stakes, and prepare unsigned
launch, stake and claim transactions. It cannot sign them: the server never holds a key.

To let Claude act with your key, give it a script that uses this kit, for example
[`launch-with-own-key.ts`](./launch-with-own-key.ts), and ask it to run that script. The kit checks
each transaction against what was asked (chain, sender, ADEXTO contract, exact amounts) before your
key signs it.
