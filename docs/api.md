# API reference

Base URL: `http://localhost:4029` when self-hosting. Machine-readable equivalents:
[`openapi.json`](https://github.com/nirholas/x402-skill-md/blob/main/openapi.json) and
[`/.well-known/x402`](https://github.com/nirholas/x402-skill-md/blob/main/public/.well-known/x402).
The format itself is specified in [spec.md](spec.md).

Prices are USDC. Every paid route accepts **both** rails — Base (EVM) and Solana — and
returns the purchased artifact in the 200 body.

Everything here is also available for free as a library and CLI: `npm i x402-skill-md`,
`npx x402-skill-md`. The HTTP service exists for agents that cannot install anything.

---

## `POST /generate`

**Price:** $0.01 · **Returns:** the generated `skill.md` plus a validation report for it

### Request body

Either the OpenAPI document itself, or a wrapper:

```json
{
  "openapi": { "openapi": "3.1.0", "info": { … }, "paths": { … } },
  "options": { "baseUrl": "https://api.example.com", "contact": "ops@example.com" }
}
```

| option | type | default | effect |
|---|---|---|---|
| `baseUrl` | string | `servers[0].url`, else `http://localhost:4021` | the base URL written into the document |
| `contact` | string | `info.contact.email` / `info.contact.url` | the contact line |
| `defaultPrice` | string | — | price for paid operations with no determinable amount |
| `frontmatter` | boolean | `true` | emit the YAML frontmatter block |
| `rails` | array | the suite's dual-rail pair | rails to document; see [spec §5.3](spec.md) |
| `manifestPath` | string | `/.well-known/x402` | manifest path in the service card |
| `openapiPath` | string | `/openapi.json` | OpenAPI path in the service card |

### How pricing is determined

In order of preference:

1. `x-x402.price` (or `x-402.price`) on the operation — `"$0.001"`
2. the `maxAmountRequired` in a 402 response **example**, converted from USDC base units
3. `options.defaultPrice`
4. otherwise: an operation with **no 402 response** is treated as `free`

Every guess produces an entry in `warnings`. The generator never invents a price silently.

### Response 200

```json
{
  "skillMdVersion": "1.0",
  "skillMd": "---\nskillMd: \"1.0\"\nname: x402-podcasts\n---\n\n# x402-podcasts\n…",
  "service": {
    "name": "x402-podcasts",
    "baseUrl": "http://localhost:4028",
    "endpoints": 6,
    "paid": 2
  },
  "warnings": [],
  "validation": {
    "valid": true,
    "score": 100,
    "summary": { "errors": 0, "warnings": 0, "infos": 0 },
    "findings": []
  },
  "generatedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "evm", "network": "base-sepolia", "transaction": "0x…" }
}
```

| field | meaning |
|---|---|
| `skillMd` | the file, ready to write to disk and commit |
| `service.endpoints` / `service.paid` | how many operations were found, and how many are paid |
| `warnings` | anything guessed or missing from the source document |
| `validation` | the generator's own output run through the validator — a generated file should be conformant, and if it is not, the OpenAPI was thin |

### Errors

| status | `error` | cause |
|---|---|---|
| 400 | `BAD_REQUEST` | body is not a JSON object |
| 400 | `NOT_AN_OPENAPI_DOCUMENT` | the posted JSON has no `paths` object |
| 400 | `GENERATE_FAILED` | conversion threw; `message` says why |
| 402 | — | payment required or rejected |

---

## `POST /validate`

**Price:** $0.002 · **Returns:** the full validation report

### Request body

Either raw markdown with `content-type: text/markdown` (or `text/plain`), or JSON:

```json
{ "skillMd": "# my-service\n\nDoes a thing.\n\n## Payment\n…" }
```

Limit 2 MB.

### Response 200

**A non-conformant document is a 200, not an error.** You paid for the report, and the report
is the artifact. Only an unparseable *request* is a 4xx.

```json
{
  "skillMdVersion": "1.0",
  "valid": false,
  "score": 0,
  "summary": { "errors": 8, "warnings": 3, "infos": 2 },
  "service": {
    "name": "broken-service",
    "baseUrl": null,
    "contact": null,
    "endpoints": [],
    "rails": { "evm": false, "solana": false },
    "dualRail": false
  },
  "findings": [
    {
      "rule": "SM002",
      "severity": "error",
      "title": "Missing summary paragraph",
      "detail": "The text under the title is only 10 characters — too short to tell an agent what this service does.",
      "fix": "Put one prose paragraph directly under the H1 saying what the service does and what an agent gets from it.",
      "line": 1
    },
    {
      "rule": "SM006",
      "severity": "error",
      "title": "No Solana payment rail documented",
      "detail": "There is no Payment section, so no Solana rail is documented.",
      "fix": "Name a Solana network (`solana` or `solana-devnet`) and its `payTo` address in the Payment section. Every conformant skill.md is dual-rail: an agent's wallet lives on one chain, and it must be able to tell from this file alone whether it can pay."
    }
  ],
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "solana", "network": "solana", "transaction": "5Qm…" }
}
```

### Fields

| field | type | meaning |
|---|---|---|
| `valid` | boolean | **zero errors.** Independent of `score` — this is the gate |
| `score` | 0–100 | 100 − 12 per error − 4 per warning − 1 per info, floored at 0. A quality signal |
| `summary` | object | counts by severity |
| `service.name` | string \| null | the H1 |
| `service.baseUrl` | string \| null | the URL found on a "Base URL" line |
| `service.contact` | string \| null | the first email in the document |
| `service.endpoints` | array | `{ method, path, price }` for every conformant endpoint heading |
| `service.rails` | `{ evm, solana }` | whether each rail was found in the Payment section |
| `service.dualRail` | boolean | both — the thing rules SM005/SM006 exist to enforce |
| `findings` | `Finding[]` | see below |
| `checkedAt` | ISO 8601 | when the check ran |

#### `Finding`

| field | type | meaning |
|---|---|---|
| `rule` | string | stable rule id, e.g. `SM006`. Never reused, even if a rule is retired |
| `severity` | `error` \| `warning` \| `info` | see [spec §9](spec.md) |
| `title` | string | the rule's name |
| `detail` | string | what is wrong **in this document** |
| `fix` | string | the remedy, verbatim from the catalogue |
| `line` | integer | 1-based, when the problem has a location |

### Errors

| status | `error` | cause |
|---|---|---|
| 400 | `BAD_REQUEST` | empty body, or neither markdown nor `{ skillMd }` |
| 400 | `VALIDATE_FAILED` | the file could not be parsed at all |
| 402 | — | payment required or rejected |

---

## `GET /rules` — free

The whole catalogue. Free on purpose: you should be able to see what you are being judged
against before paying to be judged, and most problems are cheaper to avoid than to diagnose.

```json
{
  "skillMdVersion": "1.0",
  "count": 23,
  "rules": [
    {
      "id": "SM006",
      "severity": "error",
      "title": "No Solana payment rail documented",
      "fix": "Name a Solana network (`solana` or `solana-devnet`) and its `payTo` address in the Payment section…"
    }
  ]
}
```

Same data as `npx x402-skill-md rules --json`.

## `GET /spec` — free

The [format specification](spec.md), as `text/markdown`.

## Other free routes

| route | returns |
|---|---|
| `GET /` | service card: rails, prices, format version, library and CLI hints |
| `GET /health` | `{ ok: true, uptime: <seconds>, skillMdVersion }` |
| `GET /skill.md` | this service's own contract file — a worked example of the format |
| `GET /.well-known/x402` | resource manifest with prices, rails and schemas |
| `GET /openapi.json` | OpenAPI 3.1 |

---

## Library API

The HTTP routes are thin wrappers over exported functions:

```ts
import {
  openapiToSkillMd,   // POST /generate
  validateSkillMd,    // POST /validate
  parseSkillMd,       // the structure behind the report
  formatReport,       // the CLI's human rendering
  RULES,              // GET /rules
  DEFAULT_RAILS,
  SKILL_MD_VERSION,
} from "x402-skill-md";
```

| export | signature |
|---|---|
| `openapiToSkillMd` | `(doc, options?) => { skillMd, service, warnings }` |
| `validateSkillMd` | `(raw: string) => ValidationReport` |
| `validateParsed` | `(doc: ParsedSkill) => ValidationReport` |
| `parseSkillMd` | `(raw: string) => ParsedSkill` |
| `findSection` | `(doc, title) => ParsedSection \| undefined` |
| `formatReport` | `(report) => string` |

`ParsedSkill` carries `frontmatter`, `title`, `intro`, `sections`, `endpoints`,
`malformedEndpointHeadings` and `codeBlocks` — enough to build your own tooling without
re-parsing Markdown.

---

## Payment

### The 402 body

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [ /* one PaymentRequirements per rail */ ]
}
```

`PaymentRequirements`:

| field | example | notes |
|---|---|---|
| `scheme` | `"exact"` | the only scheme accepted |
| `network` | `"base-sepolia"` / `"solana"` | switched by `NETWORK` and `SOLANA_NETWORK` |
| `maxAmountRequired` | `"10000"` | base units; USDC has 6 decimals, so this is $0.01 |
| `resource` | `"http://localhost:4029/generate"` | absolute URL being purchased |
| `description` | `"Generate a conformant skill.md…"` | shown by wallets and the checkout modal |
| `mimeType` | `"application/json"` | what the 200 will be |
| `payTo` | `0x40252CF…` / `WwwuGbqH…` | receive address for that rail |
| `maxTimeoutSeconds` | `60` | how long the authorisation stays valid |
| `asset` | USDC address / SPL mint | the token you pay in |
| `extra` | `{ name, version }` / `{ name, decimals, feePayer }` | EIP-712 domain on EVM; the fee sponsor on Solana |

Facilitators are **per rail** — `FACILITATOR_URL` for EVM (default `https://x402.org/facilitator`,
which settles Base Sepolia only) and `SOLANA_FACILITATOR_URL` for Solana (default
`https://facilitator.payai.network`).

### The receipt

Paid responses set `X-PAYMENT-RESPONSE` to base64 JSON and repeat it inline as `receipt`:

```json
{
  "success": true,
  "rail": "evm",
  "network": "base-sepolia",
  "transaction": "0xabc…",
  "payer": "0xYourWallet",
  "amount": "10000",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "resource": "http://localhost:4029/generate"
}
```

### 402 reasons

| `error` | meaning |
|---|---|
| `X-PAYMENT header is required` | first, unpaid attempt — normal |
| `invalid X-PAYMENT header: …` | not base64, or not a valid x402 payload |
| `unsupported rail: this endpoint does not accept exact on <network>` | you signed on a rail this server does not take |
| `payment rejected: <reason>` | the facilitator's `invalidReason` |
| `settlement failed: <reason>` | verified but could not be broadcast |

A facilitator outage returns `502 facilitator_unreachable` or `502 settlement_error` rather
than a 402, so a retry loop cannot mistake an outage for a price.
