# The raw 402 → pay → 200 walkthrough

No SDK — just HTTP, so you can see exactly what the protocol does.

```bash
npm install && npm run dev     # http://localhost:4029
```

## 0. Discover the service, and the rules, for free

```bash
curl -s localhost:4029/ | jq '{name, skillMdVersion, endpoints}'
curl -s localhost:4029/rules | jq '{skillMdVersion, count}'
curl -s localhost:4029/spec | head -5
```

```
{ "skillMdVersion": "1.0", "count": 23 }
```

The whole rule catalogue and the specification are free. You should be able to see what you
are being judged against before paying to be judged — and in most cases self-check first and
never need the paid route at all.

```bash
curl -s localhost:4029/rules | jq '.rules[] | select(.severity=="error") | {id, title}'
```

## 1. Validate without paying → 402 with **both** rails

```bash
curl -i -s -X POST localhost:4029/validate \
  -H 'content-type: text/markdown' \
  --data-binary @skill.md
```

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "2000",              // 2000 base units = $0.002 USDC (6 dp)
      "resource": "http://localhost:4029/validate",
      "description": "Validate a posted skill.md and return a report with per-finding fixes",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "2000",
      "resource": "http://localhost:4029/validate",
      "description": "Validate a posted skill.md and return a report with per-finding fixes",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

Note the two facilitators behind those rails: `x402.org` settles the Base Sepolia entry,
PayAI settles the Solana one. They are not interchangeable.

## 2. Build the payment

`X-PAYMENT` is base64 of a JSON payload proving you authorised exactly
`maxAmountRequired` to `payTo` on the rail you chose.

**EVM rail** — an EIP-3009 `transferWithAuthorization` signature:

```jsonc
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base-sepolia",
  "payload": {
    "signature": "0x…",
    "authorization": {
      "from": "0xYourWallet",
      "to": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "value": "2000",
      "validAfter": "0",
      "validBefore": "1791234567",
      "nonce": "0x…"
    }
  }
}
```

**Solana rail** — a signed SPL `transferChecked` transaction, base64, in the same envelope.
`@three-ws/x402-payment-modal/server` builds and encodes it client-side
(`prepareSolanaCheckout` → sign → `encodeX402Payment`); verification and settlement still
happen server-side through the facilitator.

```bash
X_PAYMENT=$(printf '%s' "$PAYLOAD_JSON" | base64 -w0)
```

## 3. Retry with the header → 200 + the report

```bash
curl -i -s -X POST localhost:4029/validate \
  -H 'content-type: text/markdown' \
  -H "X-PAYMENT: $X_PAYMENT" \
  --data-binary @broken.md
```

Where `broken.md` is:

```markdown
# broken-service

Too short.

## `GET /thing` — 1 cent
```

```http
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJyYWlsIjoiZXZtIiwi…
```

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
    },
    {
      "rule": "SM008",
      "severity": "error",
      "title": "Endpoint heading does not match the grammar",
      "detail": "`## `GET /thing` — 1 cent` names an HTTP method but does not match the endpoint grammar.",
      "fix": "Use ``## `METHOD /path` — $0.001`` : backticked `METHOD /path`, a dash, then `$amount` or `free`.",
      "line": 5
    }
  ],
  "checkedAt": "2026-08-07T12:00:00.000Z"
}
```

**That 200 is the point.** A non-conformant document is a *successful report*, not an error —
you bought the findings, and the findings are the artifact. Only an unparseable request
(empty body, wrong content type) is a 4xx.

That exact output, minus the payment, is what you get for free from the CLI:

```bash
npx x402-skill-md validate broken.md --json
```

## 4. Generate — $0.01

```bash
curl -s -X POST localhost:4029/generate \
  -H 'content-type: application/json' \
  -H "X-PAYMENT: $X_PAYMENT_10000" \
  -d '{"openapi": '"$(cat openapi.json)"', "options": {"baseUrl": "https://api.example.com"}}' \
  | jq -r .skillMd > skill.md
```

The response also carries a validation report for what it just generated:

```bash
… | jq '{service, warnings, validation: .validation | {valid, score}}'
```

```json
{
  "service": { "name": "x402-podcasts", "baseUrl": "http://localhost:4028", "endpoints": 6, "paid": 2 },
  "warnings": [],
  "validation": { "valid": true, "score": 100 }
}
```

`warnings` is where the generator admits what it had to guess — a missing summary, a price it
could not determine. It never invents a price silently.

## 5. Prices are separate payments

`$0.01` for generate, `$0.002` for validate. `X-PAYMENT` is not a session: each paid call
needs its own signed payment for its own amount. Get the challenge from an unpaid call to the
route you want.

## Errors you may hit

| what you sent | you get |
|---|---|
| no header on a paid route | 402, `error: "X-PAYMENT header is required"` |
| garbage header | 402, `error: "invalid X-PAYMENT header: …"` |
| a rail we don't take | 402, `error: "unsupported rail: …"` |
| short-paid or expired authorisation | 402, `error:` the facilitator's `invalidReason` |
| an empty body | 400, `BAD_REQUEST` |
| JSON with no `paths` to `/generate` | 400, `NOT_AN_OPENAPI_DOCUMENT` |
| a *non-conformant* skill.md | **200**, `valid: false` — that is a report, not an error |
