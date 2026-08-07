---
skillMd: "1.0"
name: x402-skill-md
baseUrl: http://localhost:4029
manifest: /.well-known/x402
openapi: /openapi.json
contact: nichxbt@gmail.com
---

# x402-skill-md

The toolkit for `skill.md` — the agent-facing contract file an x402 service ships at its
root, so a model can learn what a service does, what each call costs, on which chains it can
pay, and what comes back, in one fetch. This service generates a conformant `skill.md` from
an OpenAPI document, and validates an existing one against 23 rules, returning a per-finding
fix rather than a verdict. It also **defines the format**: the specification lives at
`GET /spec` and the machine-readable rule catalogue at `GET /rules`, both free.

- **Base URL:** `http://localhost:4029` (self-host) — replace with your deployment's origin.
- **Manifest:** `GET /.well-known/x402`
- **OpenAPI:** `GET /openapi.json`
- **Specification:** `GET /spec` · <https://nirholas.github.io/x402-skill-md/spec>
- **Also a library and CLI:** `npm i x402-skill-md` · `npx x402-skill-md generate openapi.json`
- **Contact:** nichxbt@gmail.com

## Payment

This service speaks **x402** (HTTP 402 Payment Required), protocol version 1, scheme
`exact`. Every paid route answers an unpaid request with a 402 whose `accepts` array carries
**two rails — USDC on Base (EVM) and USDC on Solana. Your client picks whichever it can
sign.**

| rail | network | asset | payTo | facilitator |
|---|---|---|---|---|
| evm | `base-sepolia` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| solana | `solana` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

Facilitators are per rail, not per service: the reference `x402.org` facilitator settles
Base Sepolia only, so the Solana rail points at PayAI's. Override with `FACILITATOR_URL` and
`SOLANA_FACILITATOR_URL`.

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "10000",
      "resource": "http://localhost:4029/generate",
      "description": "Generate a conformant skill.md from a posted OpenAPI document",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "10000",
      "resource": "http://localhost:4029/generate",
      "description": "Generate a conformant skill.md from a posted OpenAPI document",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

- **Asset:** USDC (6 decimals) on both rails. `maxAmountRequired` is in base units —
  `"10000"` is $0.01.
- **How to pay:** any x402 client. `x402-fetch` + `viem` on the EVM rail; on Solana build the
  SPL `transferChecked` (the network fee is sponsored by `extra.feePayer`, so you need no
  SOL), sign it, and base64 the envelope into `X-PAYMENT`.
- **Receipt:** paid responses carry `X-PAYMENT-RESPONSE` (base64 JSON with `rail`, `network`,
  `transaction`, `payer`, `amount`) and repeat it inline as `receipt`.

Payment is per request. No account, no key, no minimum.

## `POST /generate` — $0.01

Turn an OpenAPI 3.x document into a conformant `skill.md`. The generated file comes back in
this response body, together with a validation report for it, so one call gives you something
you can commit.

**Parameters**

| name | in | type | required | notes |
|---|---|---|---|---|
| *(body)* | body | object | yes | The OpenAPI document itself, **or** `{ "openapi": <doc>, "options": {…} }` |
| `options.baseUrl` | body | string | no | Overrides `servers[0].url` |
| `options.contact` | body | string | no | Overrides `info.contact.email` |
| `options.defaultPrice` | body | string | no | Price for paid operations with no declared amount, e.g. `"$0.001"` |
| `options.frontmatter` | body | boolean | no | Emit the YAML frontmatter block. Default `true` |
| `options.rails` | body | array | no | Rails to document. Defaults to the suite's dual-rail pair |

Pricing is read from, in order: `x-x402.price` on the operation; the `maxAmountRequired` in a
402 response example, converted from USDC base units; `options.defaultPrice`; otherwise the
operation is treated as free if it declares no 402. Anything guessed is reported in
`warnings` — the generator never invents a price silently.

**Response 200**

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

## `POST /validate` — $0.002

Check a `skill.md` against all 23 rules. The report names every finding, where it is, what
is wrong *in this document*, and the exact remedy.

**Parameters**

| name | in | type | required | notes |
|---|---|---|---|---|
| *(body)* | body | string \| object | yes | The file as `text/markdown`, or JSON `{ "skillMd": "…" }` |

**Response 200**

```json
{
  "skillMdVersion": "1.0",
  "valid": false,
  "score": 88,
  "summary": { "errors": 1, "warnings": 0, "infos": 0 },
  "service": {
    "name": "x402-github-bounty",
    "baseUrl": "http://localhost:4027",
    "contact": "nichxbt@gmail.com",
    "endpoints": [{ "method": "POST", "path": "/bounties", "price": "$0.01" }],
    "rails": { "evm": true, "solana": true },
    "dualRail": true
  },
  "findings": [
    {
      "rule": "SM007",
      "severity": "error",
      "title": "No endpoints documented",
      "detail": "No level-2 heading matches the endpoint grammar.",
      "fix": "Document at least one endpoint as `## `METHOD /path` — $price` (or `— free`)."
    }
  ],
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "solana", "network": "solana", "transaction": "5Qm…" }
}
```

`valid` is `true` when there are **zero errors**, independent of `score`. The score (100
minus 12 per error, 4 per warning, 1 per info) is a quality signal; `valid` is the gate.

## Free routes

| route | returns |
|---|---|
| `GET /` | service card: rails, prices, format version, library and CLI hints |
| `GET /health` | `{ ok, uptime, skillMdVersion }` |
| `GET /rules` | the full rule catalogue as JSON — id, severity, title, fix |
| `GET /spec` | the SKILL-MD format specification, `text/markdown` |
| `GET /skill.md` | this file |
| `GET /.well-known/x402` | machine-readable resource manifest |
| `GET /openapi.json` | OpenAPI 3.1 |

`GET /rules` is deliberately free: you should be able to see what you are being judged
against before paying to be judged.

## The format, in one paragraph

A `skill.md` is Markdown with a defined section grammar: one H1, a summary paragraph, a
service card with a base URL, a `## Payment` section documenting **both an EVM and a Solana
rail**, one `` ## `METHOD /path` — $price `` section per endpoint with a parameter table and a
real JSON response example, and a `## Errors` section that mentions the 402. Dual rail is
mandatory, not optional: an agent's wallet lives on one chain, and it must be able to tell
from this file alone whether it can pay at all. Full specification: `GET /spec`.

## Errors

| status | body `error` | meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | empty body, or neither markdown nor `{ skillMd }` / an OpenAPI document |
| 400 | `NOT_AN_OPENAPI_DOCUMENT` | the posted JSON has no `paths` object |
| 400 | `GENERATE_FAILED` | the document could not be converted; `message` says why |
| 400 | `VALIDATE_FAILED` | the file could not be parsed at all |
| 402 | — | payment required or rejected; body is the dual-rail challenge with `error` explaining why |

Note that a *non-conformant* `skill.md` is a **200 with `valid: false`**, not an error — you
paid for the report and the report is the artifact. Only an unparseable request is a 4xx.

## Data source

Self-contained. There is no upstream API, no key, and no fixture mode: generation and
validation are pure functions of what you post, so the same input always produces the same
output. Nothing you send is stored.
