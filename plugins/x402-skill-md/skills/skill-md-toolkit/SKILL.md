---
name: skill-md-toolkit
description: Generate a skill.md from an OpenAPI 3 document and validate skill.md files against the SKILL-MD rules, with the x402-skill-md CLI. Use when publishing an API so agents can discover and pay for it.
---

# x402-skill-md generator and validator

The package `x402-skill-md` (on npm) provides a CLI and library. The repo also runs the same logic as a paid HTTP service.

## Run the server

The repo is a self-hosted Express service. It is not published to npm, so run it from a clone.

```bash
git clone https://github.com/nirholas/x402-skill-md && cd x402-skill-md
npm install
cp .env.example .env   # optional: the defaults run out of the box
npm run dev            # listens on http://localhost:4029 (override with PORT)
```

Set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env` to receive payments yourself.
`GET http://localhost:4029/.well-known/x402` lists every route with its price, and `GET /health` is the liveness probe.

## Routes

### CLI (no clone needed)

```bash
npx -y x402-skill-md generate openapi.json -o skill.md [--base-url URL] [--contact EMAIL] [--default-price '$0.001'] [--no-frontmatter]
npx -y x402-skill-md validate skill.md [--json] [--strict]
npx -y x402-skill-md rules [--json]
```

Use `-` as the file to read stdin. `validate` exits 0 when conformant, 1 on errors (or warnings with `--strict`), 2 on bad usage.

### HTTP service routes

| Route | Price | Purpose |
|---|---|---|
| `POST /generate` | $0.01 | Body is the OpenAPI document or `{openapi, options: {baseUrl, contact}}`. Returns the skill.md and its validation report |
| `POST /validate` | $0.002 | Body is the skill.md as `text/markdown` or `{skillMd}` |
| `GET /rules`, `GET /spec`, `GET /health`, `GET /skill.md`, `GET /openapi.json`, `GET /.well-known/x402` | free | Rule catalogue, format spec, discovery |

The full request and response schemas are in `skill.md` at the repo root (the running server also serves it at `GET /skill.md`).

## Paying

Paid routes answer an unpaid request with HTTP 402 and an `accepts` array with one entry per rail (USDC on Base and USDC on Solana). A client picks an entry, signs, and retries with the `X-PAYMENT` header. The 200 body carries the artifact and an `X-PAYMENT-RESPONSE` header carries the settlement receipt. Any x402 client works (`x402-fetch` with `viem` on the EVM rail). Each paid call spends real USDC on whichever network the server is configured for (`NETWORK`, `SOLANA_NETWORK`), so show the user the route, price and network and get a yes before paying.

## Worked example

```bash
npx -y x402-skill-md rules --json | head
npx -y x402-skill-md generate openapi.json -o skill.md
npx -y x402-skill-md validate skill.md --strict
```

Fix every finding the validator names (each states the rule, where, and the remedy), then rerun until it exits 0.
