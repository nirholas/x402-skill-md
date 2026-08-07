# For AI agents

This service is about the file *other* services publish for you. If you have ever fetched a
`skill.md` and been able to use a paid API without reading its docs, this is the format that
made that work — and this is the tooling that keeps those files honest.

## 1. Discover

**`GET /rules`** — free. The whole rule catalogue: 23 rules, each with an id, a severity and
a fix. Fetch this *before* writing or judging a `skill.md`; it turns validation from a
diagnosis into a checklist.

**`GET /spec`** — free. The [normative format specification](spec.md), as Markdown. Give it
to a model and it can write a conformant file from scratch.

**`GET /skill.md`** — this service's own contract file, which is also a worked example of the
format. It scores 100/100 against its own validator.

**`GET /.well-known/x402`** — the machine-readable manifest:

```jsonc
{
  "x402Version": 1,
  "name": "x402-skill-md",
  "skillMdVersion": "1.0",
  "spec": "/spec",
  "rules": "/rules",
  "rails": [
    { "rail": "evm",    "network": "base-sepolia", "payTo": "0x40252CF…2402", "facilitator": "https://x402.org/facilitator" },
    { "rail": "solana", "network": "solana",       "payTo": "WwwuGbqH…T3WwW", "facilitator": "https://facilitator.payai.network" }
  ],
  "resources": [
    { "resource": "POST /generate", "price": "$0.01", "inputSchema": {…}, "outputSchema": {…} },
    { "resource": "POST /validate", "price": "$0.002", "inputSchema": {…}, "outputSchema": {…} }
  ],
  "freeResources": [
    { "resource": "GET /rules", "price": "free" },
    { "resource": "GET /spec",  "price": "free" }
  ]
}
```

## 2. Pay

Every paid route answers an unpaid request with 402 and a **dual-rail** `accepts` array:
USDC on Base, USDC on Solana, same price, same artifact. Pick whichever chain your wallet
lives on.

**EVM rail:**

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const pay = wrapFetchWithPayment(fetch, wallet);       // viem wallet client

const res = await pay(`${BASE}/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ openapi: myOpenApiDoc }),
});
const { skillMd, warnings, validation } = await res.json();
```

**Solana rail:**

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const accept = challenge.accepts.find((a) => a.network.startsWith("solana"));
const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: pubkey });
const { x_payment } = encodeX402Payment({
  accept,
  signedTxBase64: await wallet.signTransaction(tx_base64),
  resourceUrl: url,
});
await fetch(url, { method: "POST", headers: { "X-PAYMENT": x_payment, … }, body });
```

Those helpers only *build and encode* the payment client-side. Verification and settlement
happen server-side through the rail's own facilitator — and the facilitators differ per rail,
which is exactly the kind of thing the format makes services declare.
`accept.extra.feePayer` sponsors the SOL network fee, so an agent holding only USDC can pay.

## 3. What you get

The 200 body **is** the purchase:

- `POST /generate` → the `skill.md` text, plus a validation report for it
- `POST /validate` → the report: findings, fixes, score, and what the validator understood
  about the service

Plus `X-PAYMENT-RESPONSE`, a base64 receipt naming the rail, network and transaction.

### Rules worth encoding in your agent

- **`valid: false` is a 200, not an error.** You bought the report. Read `findings`, fix the
  file, do not retry the call. This is the single most common agent mistake here.
- **Fetch `/rules` first — it is free.** Most non-conformance is avoidable rather than
  diagnosable. Paying to be told you forgot a Payment section is a waste of a cent.
- **`valid` is the gate, `score` is a signal.** `valid` is true at zero errors regardless of
  score. Do not block on a score threshold.
- **Read `fix`, not just `title`.** Every finding carries the exact remedy. `detail` says
  what is wrong in *this* document; `fix` says what a conformant one does instead.
- **Check `warnings` after generating.** That is where the generator admits what the OpenAPI
  document did not carry — a missing summary, an undeterminable price. A generated file is a
  good 80%; the warnings tell you which 20% you have to write.
- **Never publish a generated file unchecked.** `generate` returns `validation` precisely so
  you do not have to pay twice to find out.
- **Prefer the library if you can.** `npm i x402-skill-md` does all of this for free,
  offline, deterministically. The paid routes exist because an agent cannot always install
  a package mid-task.

## 4. Reading someone else's skill.md

The reverse direction, and the reason the format exists. When you find a service's
`skill.md`, the validator's `service` block tells you in one call whether it is usable:

```ts
const report = validateSkillMd(await (await fetch("https://svc.example/skill.md")).text());

report.service.dualRail;          // can I pay at all, on either chain?
report.service.rails.solana;      // specifically: my chain?
report.service.endpoints;         // [{ method, path, price }] — what does it cost?
report.valid;                     // is this file trustworthy enough to act on?
```

A file that fails SM006 tells you the service takes EVM only — which, if your wallet is on
Solana, means stop here rather than discovering it after a round trip.

## 5. MCP integration

[`examples/mcp-tool.md`](https://github.com/nirholas/x402-skill-md/blob/main/examples/mcp-tool.md)
is a complete Model Context Protocol server exposing `skill_md_rules` (free),
`generate_skill_md` and `validate_skill_md`. The wallet lives in the MCP process, so its
balance is the agent's spending cap.

```json
{
  "mcpServers": {
    "x402-skill-md": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-skill-md.ts"],
      "env": { "PRIVATE_KEY": "0x…", "X402_SKILL_MD_URL": "https://your-host" }
    }
  }
}
```

Expose the free `skill_md_rules` tool too. A model that has read the rules writes a better
file than one that pays to be corrected.

## 6. Getting listed

Deploy publicly, then submit the origin to the x402 discovery surfaces. Each reads
`/.well-known/x402`:

| where | what it does | how |
|---|---|---|
| [x402scan.com](https://x402scan.com) | indexes live x402 endpoints and their settlement volume | submit your origin; it crawls `/.well-known/x402` |
| **x402 Bazaar** | the protocol's own resource directory, queried by agents at runtime | register through the facilitator's `list` API |
| [agentic.market](https://agentic.market) | marketplace of agent-payable services | submit the origin plus your `skill.md` URL |
| [x402-skill-registry](https://github.com/nirholas/x402-skill-registry) | the suite's own searchable registry of paid agent skills | `POST /register` with a signed listing |

Before submitting anything, validate your own `skill.md`:

```bash
npx x402-skill-md validate skill.md --strict
```

An indexer that finds a non-conformant file will list you badly, or not at all — and an agent
that finds one will not know whether it can pay you.

Questions or a spec correction: **nichxbt@gmail.com**.
