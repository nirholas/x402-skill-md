# Tutorial — write a skill.md that agents can actually use

Three ways in, in increasing order of ceremony: the CLI (free, local), the library (free,
embedded), and the paid service (for agents that cannot install anything). Start with the
CLI.

## 1. Validate something you already have

No install, no clone, no wallet:

```bash
npx x402-skill-md validate skill.md
```

```
PASS  score 100/100  (0 errors, 0 warnings, 0 infos)
service: x402-domains  endpoints: 2  rails: evm + solana

No findings. This document is conformant.
```

A file with problems tells you what they are and how to fix them:

```bash
printf '# broken-service\n\nToo short.\n\n## `GET /thing` — 1 cent\n' > broken.md
npx x402-skill-md validate broken.md
```

```
FAIL  score 0/100  (8 errors, 3 warnings, 2 infos)
service: broken-service  endpoints: 0  rails: none

✗ SM002 (line 1)  Missing summary paragraph
    The text under the title is only 10 characters — too short to tell an agent what this service does.
    fix: Put one prose paragraph directly under the H1 saying what the service does and what an agent gets from it.
✗ SM003  Missing base URL
    No line documents a base URL with a resolvable URL on it.
    fix: Document the base URL, e.g. `- **Base URL:** https://your-host` (a localhost placeholder is fine for a self-hosted service).
✗ SM006  No Solana payment rail documented
    There is no Payment section, so no Solana rail is documented.
    fix: Name a Solana network (`solana` or `solana-devnet`) and its `payTo` address in the Payment section. Every conformant skill.md is dual-rail: an agent's wallet lives on one chain, and it must be able to tell from this file alone whether it can pay.
✗ SM008 (line 5)  Endpoint heading does not match the grammar
    `## `GET /thing` — 1 cent` names an HTTP method but does not match the endpoint grammar.
    fix: Use ``## `METHOD /path` — $0.001`` : backticked `METHOD /path`, a dash, then `$amount` or `free`.
…
```

`--json` gives the same thing as a machine-readable report. `--strict` also fails on
warnings.

## 2. See the rules before you write anything

```bash
npx x402-skill-md rules
npx x402-skill-md rules --json | jq '.rules | to_entries[] | select(.value.severity=="error") | .key'
```

23 rules: 10 errors, 10 warnings, 3 infos. Reading them first turns validation from a
diagnosis into a checklist. The full normative text is the [specification](spec.md).

## 3. Generate from OpenAPI

If you already have an OpenAPI document, do not write the file by hand:

```bash
npx x402-skill-md generate openapi.json -o skill.md \
  --base-url https://api.example.com \
  --contact ops@example.com
```

```
wrote skill.md — x402-podcasts, 2 paid of 6 endpoints
```

Then check it:

```bash
npx x402-skill-md validate skill.md
# PASS  score 100/100
```

### Declaring prices

The generator reads a price from, in order of preference:

1. **`x-x402` on the operation** — the exact, declarative way:

   ```json
   "/search": {
     "get": {
       "summary": "Search shows",
       "x-x402": { "price": "$0.002" },
       "responses": { "200": {…}, "402": {…} }
     }
   }
   ```

2. The `maxAmountRequired` in a **402 response example**, converted from USDC base units.
3. `--default-price` from the command line.
4. Otherwise: an operation with **no 402 response** is treated as free.

Anything guessed comes back as a warning on stderr:

```
warning: GET /reports: declares a 402 response but no price could be determined.
         Add `x-x402: { price: "$0.001" }` to the operation, or pass defaultPrice.
```

The generator never invents a price silently. A wrong price in a published contract is worse
than a missing one.

### What the generator cannot invent

It will warn, not guess, when the OpenAPI document is thin:

| missing in OpenAPI | effect | fix |
|---|---|---|
| `info.summary` / `info.description` | the summary paragraph is a stub | write one — it is the first thing a model reads |
| a 200 example or schema | the endpoint section has no response example (SM009) | add `content.application/json.example` |
| operation `description` | the section says "Returns the resource in the 200 body" | write one sentence saying what the body contains |

A generated file is a good 80%. The last 20% — the sentence explaining what `status: unknown`
means, the note that fixtures exist — is the part that makes an agent behave correctly, and
only you can write it.

## 4. Use it as a library

```bash
npm i x402-skill-md
```

```ts
import { readFile, writeFile } from "node:fs/promises";
import { openapiToSkillMd, validateSkillMd, RULES } from "x402-skill-md";

const spec = JSON.parse(await readFile("openapi.json", "utf8"));

const { skillMd, service, warnings } = openapiToSkillMd(spec, {
  baseUrl: "https://api.example.com",
  contact: "ops@example.com",
  defaultPrice: "$0.001",
  frontmatter: true,
});

for (const w of warnings) console.warn(w);
await writeFile("skill.md", skillMd);

const report = validateSkillMd(skillMd);
console.log(report.valid, report.score);          // true 100
console.log(report.service.dualRail);             // true
console.log(report.service.endpoints);            // [{ method, path, price }, …]

// The rule catalogue is exported too — build your own reporting on it.
console.log(RULES.SM006.fix);
```

The parser is also exported if you want to do something else with the structure:

```ts
import { parseSkillMd } from "x402-skill-md";
const doc = parseSkillMd(await readFile("skill.md", "utf8"));
doc.endpoints;      // [{ method, path, price, line, hasJsonExample, … }]
doc.frontmatter;    // { skillMd: "1.0", name: "…", … } | null
doc.sections;       // every level-2 section that is not an endpoint
```

## 5. Put it in CI

`validate` exits 1 when there are errors, so it needs no wrapper:

```yaml
- name: skill.md is conformant
  run: npx x402-skill-md validate skill.md --strict
```

Add `--strict` once you are at zero warnings, so the file cannot quietly degrade. If you
generate the file, regenerate and diff instead — a `skill.md` that has drifted from its
OpenAPI is worse than none, because an agent will trust it:

```yaml
- run: npx x402-skill-md generate openapi.json > /tmp/skill.md
- run: diff -u skill.md /tmp/skill.md
```

## 6. Run the service

Everything above is free and local. The HTTP service exists for agents that cannot install
anything:

```bash
git clone https://github.com/nirholas/x402-skill-md.git
cd x402-skill-md
npm install
cp .env.example .env      # already filled with working defaults
npm run dev               # http://localhost:4029
```

```
x402-skill-md listening on http://localhost:4029
SKILL-MD format version 1.0 · 23 rules
Payment rails (USDC — the client picks):
  evm     base-sepolia   → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402  via https://x402.org/facilitator
  solana  solana         → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  via https://facilitator.payai.network
Routes:
  POST /generate         $0.01
  POST /validate         $0.002
  GET /rules             free
  GET /spec              free
```

The free routes work immediately:

```bash
curl -s localhost:4029/rules | jq '{skillMdVersion, count}'
# { "skillMdVersion": "1.0", "count": 23 }
curl -s localhost:4029/spec | head -3
```

## 7. Your first 402

```bash
curl -i -s -X POST localhost:4029/validate -H 'content-type: text/markdown' -d '# x'
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "2000",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", … },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "2000",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", … }
  ]
}
```

`maxAmountRequired` is in USDC base units — six decimals, so `"2000"` is $0.002.

## 8. Pay for one

Get a throwaway Base Sepolia wallet and a little testnet USDC from the
[Circle faucet](https://faucet.circle.com), then:

```bash
PRIVATE_KEY=0xyourTestnetKey npm run client
```

```
SKILL-MD 1.0 — 23 rules, catalogue is free at GET /rules
errors: 10, warnings: 10, infos: 3

① Unpaid request → expect a dual-rail 402
   accepts: base-sepolia   10000 base units USDC → 0x40252CF…
   accepts: solana         10000 base units USDC → WwwuGbqH…

② Generating from 0xYourWallet on Base Sepolia — $0.01

③ 200 — example-service: 1 paid of 2 endpoints
   generated file scores 100/100, valid: true

--- skill.md ---
…the whole file…
```

## 9. The one thing to understand about `/validate`

A non-conformant document is a **200 with `valid: false`**, not a 4xx. You paid for the
report and the report is the artifact — findings, fixes and all. Only an unparseable request
(empty body, wrong content type) is an error.

Agents get this wrong and retry. Say so in your tool description.

## 10. Going to mainnet

```bash
# EVM rail → Base mainnet
NETWORK=base
FACILITATOR_URL=https://your-mainnet-facilitator.example

# Solana rail → already mainnet by default
SOLANA_NETWORK=mainnet-beta
SOLANA_FACILITATOR_URL=https://facilitator.payai.network

# your own addresses, or you are donating to the suite
PAY_TO_ADDRESS=0xYourMainnetAddress
SOLANA_PAY_TO_ADDRESS=YourSolanaAddress

# so 402 challenges quote absolute public URLs
PUBLIC_BASE_URL=https://skill-md.yourdomain.com
```

Facilitators are **per rail**. `https://x402.org/facilitator` settles Base Sepolia only; the
Solana rail needs its own, which is why `SOLANA_FACILITATOR_URL` exists and defaults to
PayAI's public one. Pointing both rails at one facilitator will silently fail to settle one
of them.

Then list the deployment: submit your origin to [x402scan.com](https://x402scan.com), the
x402 Bazaar, and [agentic.market](https://agentic.market). They read `/.well-known/x402`,
which this server already serves.

## Next

- **[Specification](spec.md)** — the format itself, normative
- [API reference](api.md) — every field of every response
- [For AI agents](agents.md) — discovery, MCP, listing
- [`examples/curl.md`](https://github.com/nirholas/x402-skill-md/blob/main/examples/curl.md) — the protocol by hand
