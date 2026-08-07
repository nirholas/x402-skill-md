# Exposing x402-skill-md as an MCP tool

[Model Context Protocol](https://modelcontextprotocol.io) servers give Claude tools it can
call mid-conversation. This one is unusually well suited to it: an agent that has just
written or discovered an OpenAPI document cannot `npm install` inside its own reasoning loop,
but it can make an HTTP request and pay a cent.

## The server

```bash
npm install @modelcontextprotocol/sdk x402-fetch viem zod
```

`mcp-skill-md.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { z } from "zod";

const BASE_URL = process.env.X402_SKILL_MD_URL ?? "http://localhost:4029";

// One wallet, reused for every purchase. Its balance IS the spending cap.
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http() })
  .extend(publicActions);
const pay = wrapFetchWithPayment(fetch, wallet as never);

const server = new McpServer({ name: "x402-skill-md", version: "0.1.0" });

// Free: the rule catalogue. Expose it so the model can self-check before spending.
server.tool(
  "skill_md_rules",
  "Get the SKILL-MD rule catalogue — every rule id, severity, title and fix. FREE. " +
    "Call this before writing a skill.md by hand; most problems can be avoided rather than " +
    "diagnosed.",
  {},
  async () => {
    const res = await fetch(`${BASE_URL}/rules`);
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

server.tool(
  "generate_skill_md",
  "Turn an OpenAPI 3.x document into a conformant skill.md — the agent-facing contract file " +
    "an x402 service ships at its root. Returns the file plus a validation report for it. " +
    "$0.01 USDC, paid automatically. Declare prices as `x-x402: { price: \"$0.001\" }` on each " +
    "paid operation; anything the generator has to guess comes back in `warnings`.",
  {
    openapi: z.record(z.unknown()).describe("The OpenAPI 3.x document, parsed"),
    baseUrl: z.string().optional().describe("Overrides servers[0].url"),
    contact: z.string().optional().describe("Overrides info.contact.email"),
    defaultPrice: z.string().optional().describe('Price for paid ops with no amount, e.g. "$0.001"'),
  },
  async ({ openapi, ...options }) => {
    const res = await pay(`${BASE_URL}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openapi, options }),
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

server.tool(
  "validate_skill_md",
  "Check a skill.md against all 23 SKILL-MD rules. Returns a report naming every finding, " +
    "where it is, what is wrong, and the exact fix. $0.002 USDC. A non-conformant document " +
    "is a successful report with `valid: false` — not an error.",
  { skillMd: z.string().describe("The full contents of the skill.md file") },
  async ({ skillMd }) => {
    const res = await pay(`${BASE_URL}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillMd }),
    });
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

## Wiring it into Claude Desktop / Claude Code

`claude_desktop_config.json` (or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "x402-skill-md": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-skill-md.ts"],
      "env": {
        "PRIVATE_KEY": "0xYourFundedTestnetKey",
        "X402_SKILL_MD_URL": "https://your-deployment.example.com"
      }
    }
  }
}
```

Then:

> **You:** I just shipped an API. Here's the OpenAPI spec — write me a skill.md for it.
>
> **Claude:** *(calls `skill_md_rules` — free — to see what conformance requires, then
> `generate_skill_md` — $0.01 — and reports: 4 paid endpoints, scores 100/100, one warning
> that `/reports` had no 200 example so the section has no response block)*
>
> **You:** Fix that and check it again.
>
> **Claude:** *(adds the example, calls `validate_skill_md` — $0.002 — confirms 100/100)*

## Notes

- **Call `skill_md_rules` first.** It is free, and it turns validation from a diagnosis into
  a checklist. The paid `validate` route is worth it *after* a draft exists, not before.
- **Budget the wallet, not the tool.** The MCP process holds the key; its balance is the
  agent's spending cap.
- **For humans, use the CLI instead.** `npx x402-skill-md validate skill.md` does the same
  work for free. The paid service exists because an agent cannot `npm install` mid-thought.
- **Teach the model about the 200.** `valid: false` is a successful report; it should read
  the `findings` and fix the file, not retry the call.
- **Solana rail.** Swap `wrapFetchWithPayment` for a Solana x402 client if the agent's wallet
  lives on Solana; the service accepts either and the tool code is unchanged.
- **Discovery.** An agent that can read [`skill.md`](../skill.md) or `GET /.well-known/x402`
  can write this wrapper itself — which is, recursively, the entire point of the format.
