<h1 align="center">x402-skill-md</h1>

<p align="center">
  <b>The <code>skill.md</code> toolkit — the format, a generator, a validator.</b><br>
  A library, a CLI, and an x402-paid service. Defines the agent-facing contract file the whole suite ships.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://x402.org"><img alt="x402" src="https://img.shields.io/badge/protocol-x402-0052ff.svg"></a>
  <img alt="rails" src="https://img.shields.io/badge/USDC-Base%20%2B%20Solana-2775ca.svg">
  <img alt="format" src="https://img.shields.io/badge/SKILL--MD-1.0-6b46c1.svg">
  <a href="https://nirholas.github.io/x402-skill-md/"><img alt="docs" src="https://img.shields.io/badge/docs-Pages-24292f.svg"></a>
</p>

---

## What a `skill.md` is

The file an AI agent reads to learn how to **use and pay for** an HTTP service — in one
fetch, with no SDK and no human. It is Markdown, so a model can read it directly; it has a
defined section grammar, so a parser can check it.

OpenAPI already describes shapes. It does not describe **what a call costs, in what asset, on
which chains, to which address** — and for an agent with a wallet and no account, that is the
load-bearing information.

**[Read the specification →](docs/spec.md)**

## Use it three ways

### As a CLI

```bash
npx x402-skill-md generate openapi.json -o skill.md
npx x402-skill-md validate skill.md
npx x402-skill-md rules
```

```
PASS  score 100/100  (0 errors, 0 warnings, 0 infos)
service: x402-domains  endpoints: 2  rails: evm + solana

No findings. This document is conformant.
```

`validate` exits 1 on errors, so it drops straight into CI:

```yaml
- run: npx x402-skill-md validate skill.md --strict
```

### As a library

```bash
npm i x402-skill-md
```

```ts
import { openapiToSkillMd, validateSkillMd, RULES } from "x402-skill-md";

const { skillMd, warnings } = openapiToSkillMd(
  JSON.parse(await readFile("openapi.json", "utf8")),
  { baseUrl: "https://api.example.com", contact: "ops@example.com" },
);

const report = validateSkillMd(skillMd);
report.valid;                 // true
report.service.dualRail;      // true
report.findings;              // [] — each finding carries rule, detail, fix, line
```

Zero runtime dependencies in the library path: the parser, validator and generator are plain
TypeScript.

### As a paid service

| Route | Price | What lands in the 200 body |
|---|---|---|
| `POST /generate` | **$0.01** | The generated `skill.md`, plus a validation report for it — one call gives you a file you can commit |
| `POST /validate` | **$0.002** | The full report: every finding with its rule id, location, what is wrong *in this document*, and the exact fix |
| `GET /rules` | free | The whole rule catalogue as JSON |
| `GET /spec` | free | The format specification |
| `GET /` · `/health` · `/skill.md` · `/.well-known/x402` · `/openapi.json` | free | Discovery |

`GET /rules` is free on purpose: you should be able to see what you are being judged against
before paying to be judged.

## Why x402 for this

Validation is the definition of a spiky, per-artifact need — you check a `skill.md` when you
write one, then not again for a month. A subscription is absurd for that, and so is an API
key. But the library is also just free on npm, so the honest answer is: **the paid service
exists for agents.** An agent that generated an OpenAPI document and wants a `skill.md` for it
cannot `npm install` inside its own reasoning loop; it can make an HTTP request and pay a
cent. Humans should use the CLI.

## The format in one paragraph

Markdown with a defined section grammar: one H1, a summary paragraph, a service card with a
base URL, a `## Payment` section documenting **both an EVM and a Solana rail**, one
`` ## `METHOD /path` — $price `` section per endpoint with a parameter table and a real JSON
response example, and a `## Errors` section that mentions the 402.

### Dual rail is mandatory, not optional

A conformant `skill.md` documents an EVM rail **and** a Solana rail (rules SM005/SM006, both
`error`). The reasoning:

- An agent's wallet lives on exactly **one** chain. A single-rail service is invisible to
  every agent on the other one, and it cannot learn that cheaply.
- The 402 challenge already carries an `accepts` **array**. Two entries cost one extra
  object; the client picks. There is no protocol reason to publish one.
- Discovery indexers filter on rails. A single-rail listing halves your reachable market for
  no gain.

The spec also requires the **facilitator to be declared per rail**, because facilitators are
chain-specific: the reference `x402.org` facilitator settles Base Sepolia only and will not
settle a Solana payment. A document that names one facilitator for both rails is telling
clients something false.

## Rules

23 rules across three severities. `valid` is `true` when there are **zero errors**,
independent of score; the score (100 − 12/error − 4/warning − 1/info) is a quality signal.

| | count | meaning |
|---|---|---|
| `error` | 10 | not conformant — an agent may fail to use the service |
| `warning` | 10 | conformant but lossy — an agent has to guess |
| `info` | 3 | a suggestion |

Every finding carries a fix, not just a verdict:

```json
{
  "rule": "SM006",
  "severity": "error",
  "title": "No Solana payment rail documented",
  "detail": "There is no Payment section, so no Solana rail is documented.",
  "fix": "Name a Solana network (`solana` or `solana-devnet`) and its `payTo` address in the Payment section. Every conformant skill.md is dual-rail: an agent's wallet lives on one chain, and it must be able to tell from this file alone whether it can pay."
}
```

Full catalogue: `npx x402-skill-md rules`, `GET /rules`, or [§9 of the spec](docs/spec.md).

## Generating from OpenAPI

Pricing is read from, in order of preference:

1. `x-x402: { price: "$0.001" }` on the operation — the exact, declarative way
2. the `maxAmountRequired` in a 402 response example, converted from USDC base units
3. `options.defaultPrice`
4. otherwise, an operation with no 402 response is treated as **free**

Anything guessed is reported in `warnings`. The generator never invents a price silently —
a wrong price in a published contract is worse than a missing one.

```ts
openapiToSkillMd(doc, {
  baseUrl: "https://api.example.com",   // overrides servers[0].url
  contact: "ops@example.com",           // overrides info.contact.email
  defaultPrice: "$0.001",
  frontmatter: true,                    // emit the YAML block
  rails: [ /* defaults to the suite's dual-rail pair */ ],
});
```

## Quickstart (the service)

```bash
git clone https://github.com/nirholas/x402-skill-md.git
cd x402-skill-md
npm install
cp .env.example .env      # already filled with working defaults
npm run dev               # http://localhost:4029
```

```bash
curl -i -s -X POST localhost:4029/validate -H 'content-type: text/markdown' -d '# x'
# HTTP/1.1 402 Payment Required
# { "x402Version": 1, "accepts": [ {…base-sepolia…}, {…solana…} ] }

PRIVATE_KEY=0xyourTestnetKey npm run client
```

## Dual-rail payment: Base **or** Solana

Every 402 lists **two** payment requirements. The client picks whichever chain it can sign
on; the server settles either through that rail's facilitator and returns the same artifact.

| | EVM rail | Solana rail |
|---|---|---|
| network | `base-sepolia` (default) / `base` | `solana` (default) / `solana-devnet` |
| asset | USDC `0x036CbD…dCF7e` (sepolia) | USDC mint `EPjFWdd5…TDt1v` |
| payTo | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |
| facilitator | `https://x402.org/facilitator` | `https://facilitator.payai.network` |

Those are the suite's public receive addresses and the server runs with them out of the box.
Set `PAY_TO_ADDRESS` / `SOLANA_PAY_TO_ADDRESS` to be paid yourself. The Solana network fee is
sponsored by the facilitator's fee payer, so a payer needs USDC only — no SOL.

## Real backend / API keys

**None.** Generation and validation are pure functions of what you post: no upstream API, no
key, no fixture mode, and nothing you send is stored. The same input always produces the same
output, which is also why the library and the service cannot disagree.

## For AI agents

- **[`skill.md`](skill.md)** — this service's own contract file, and a worked example of the
  format. It scores 100/100 against its own validator, which is the least it could do.
- **`GET /.well-known/x402`** — machine-readable manifest of both paid resources with input
  and output schemas and both rails.
- **`GET /rules`** — the catalogue, free, so an agent can self-check before paying.
- **MCP** — [`examples/mcp-tool.md`](examples/mcp-tool.md) exposes `generate_skill_md` and
  `validate_skill_md` as Model Context Protocol tools.
- **Client** — [`examples/agent-client.ts`](examples/agent-client.ts) runs the full flow:
  rules → 402 → generate → validate a deliberately broken file to show the fixes.

## Docs

Full site: **<https://nirholas.github.io/x402-skill-md/>**

- **[Specification](docs/spec.md)** — the format itself, normative
- [Tutorial](docs/tutorial.md) — CLI → library → paid service → CI
- [API reference](docs/api.md) — every field of every response
- [For agents](docs/agents.md) — discovery, payment, MCP, listing

## Support

Questions, bugs, or a spec correction: **nichxbt@gmail.com** or open an issue.

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## License

Apache-2.0 — see [LICENSE](LICENSE).
