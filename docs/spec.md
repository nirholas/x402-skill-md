# The SKILL-MD format, version 1.0

**Status:** stable · **Version:** 1.0 · **Media type:** `text/markdown` · **Conventional
location:** `/skill.md` at a service's root, and `skill.md` at a repository's root

A `skill.md` is the file an AI agent reads to learn how to *use and pay for* an HTTP service,
in one fetch, with no SDK and no human. It is Markdown, so a language model can read it
directly; it has a defined section grammar, so a parser can check it. This document
specifies that grammar.

The reference implementation is [`x402-skill-md`](https://github.com/nirholas/x402-skill-md),
which generates conformant documents from OpenAPI and validates existing ones against every
rule below.

---

## 1. Why this exists

OpenAPI already describes *shapes*. It does not describe **what a call costs, in what asset,
on which chains, to which address** — and for an agent with a wallet and no account, that is
the load-bearing information. An agent must be able to answer three questions before it
spends anything:

1. Can this service do what I need?
2. What will it cost?
3. **Can I pay at all** — is there a rail my wallet lives on?

Question 3 is why this format makes **dual-rail payment mandatory** (§5). A service that
only takes USDC on Base is unusable to an agent holding USDC on Solana, and an agent that
cannot discover that fact until it has already made a request has wasted a round trip and a
planning step. The file states both rails, or it is not conformant.

### Relationship to other artifacts

| artifact | audience | answers |
|---|---|---|
| `skill.md` | language models, humans skimming | what, how much, how to pay, what comes back |
| `/.well-known/x402` | indexers, machine planners | the same, as JSON, per resource |
| `openapi.json` | code generators | exact request/response shapes |

They are three renderings of one contract and should never disagree. `x402-skill-md
generate` derives the first from the third, which is the cheapest way to keep them honest.

---

## 2. Terminology

**MUST**, **SHOULD**, **MAY** are used as in RFC 2119.

- **Document** — one `skill.md` file.
- **Endpoint section** — a level-2 heading matching §6 plus everything until the next
  level-2 heading.
- **Rail** — one chain on which a service accepts payment: a network, an asset, a `payTo`
  address and a facilitator.
- **Conformant** — the document triggers no rule of severity `error` (§9).

---

## 3. Document structure

A conformant document is, in order:

```
[frontmatter]          optional, §4
# <name>               required, exactly one H1
<summary paragraph>    required, ≥ 40 characters of prose
<service card>         required, must include a Base URL
## Payment             required, §5
## `M /path` — $price  one or more, §6
## Free routes         optional but recommended, §7
## Errors              required, §8
## Data source         required *if* responses may be non-live, §7.3
<any other sections>   allowed anywhere after the summary
```

Sections other than the ones named above are permitted and ignored by the validator. Order
is not enforced beyond "H1 first" — but the order above is what readers expect, and the
generator emits it.

### 3.1 Encoding

UTF-8. `\n` or `\r\n` line endings (both are accepted; `\r\n` is normalised on parse). No
byte-order mark.

### 3.2 Code fences

Fenced blocks are opaque to the section grammar: a `#` inside a fence is never a heading. Use
` ```json ` for response and challenge examples — the validator looks for that fence
specifically when checking rules SM009 and SM018. ` ```jsonc ` is accepted where you want
comments in an example.

---

## 4. Frontmatter (optional)

A document MAY begin with a `---`-delimited block of `key: value` lines. It exists so
indexers can read the essentials without parsing prose.

```yaml
---
skillMd: "1.0"
name: x402-domains
baseUrl: https://domains.example.com
manifest: /.well-known/x402
openapi: /openapi.json
contact: nichxbt@gmail.com
---
```

| key | required if frontmatter present | meaning |
|---|---|---|
| `skillMd` | yes | format version, currently `"1.0"` |
| `name` | no | service identifier; SHOULD match the H1 |
| `baseUrl` | no | absolute origin |
| `manifest` | no | path to the x402 manifest |
| `openapi` | no | path to the OpenAPI document |
| `contact` | no | email or URL |

This is intentionally *not* full YAML: values are plain strings, quotes are stripped, and
nesting is not supported. A malformed block raises **SM022** (warning) — never an error,
because frontmatter is optional and an indexer that cannot read it can still read the prose.

---

## 5. The Payment section

A conformant document MUST have a level-2 section whose title begins with `Payment`. It is
the part an agent needs before it can do anything else.

### 5.1 Required content

| requirement | rule |
|---|---|
| An EVM network (`base` or `base-sepolia`) **and** a `0x…` payTo address | SM005 (error) |
| A Solana network (`solana` or `solana-devnet`) **and** a base58 payTo address | SM006 (error) |
| The x402 protocol version and scheme | SM016 (warning) |
| A fenced JSON example of a real 402 body containing `accepts` | SM018 (warning) |

### 5.2 Dual rail is mandatory

**A conformant `skill.md` documents at least one EVM rail and at least one Solana rail.**
Not "may"; not "if convenient". The reasoning:

- An agent's wallet lives on exactly **one** chain. A single-rail service is invisible to
  every agent on the other chain, and it cannot learn that cheaply.
- The 402 challenge already carries an `accepts` **array**. Two entries cost one extra
  object; the client picks. There is no protocol reason to publish one.
- Discovery indexers filter on rails. A single-rail listing halves your reachable market for
  no gain.

If a service genuinely cannot settle on one of the two chains, it is not conformant to 1.0
and should say so plainly rather than imply coverage it lacks.

### 5.3 Declaring rails

The recommended rendering is a table — dense, parseable, and readable by a model:

```markdown
| rail | network | asset | payTo | facilitator |
|---|---|---|---|---|
| evm | `base-sepolia` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| solana | `solana` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |
```

Prose is also accepted — the validator looks for a network name and an address of the right
shape within the section, not for a specific layout.

#### The facilitator column is per rail, not per service

This matters and is easy to get wrong. A facilitator is the component that verifies a signed
payment and broadcasts settlement, and **facilitators are chain-specific**. The reference
`https://x402.org/facilitator` settles Base Sepolia only; it will not settle a Solana
payment. A service documenting both rails therefore has **two** facilitator endpoints, and
the document MUST show which belongs to which network. A client that assumes one facilitator
for the whole service will send a valid Solana payment to an endpoint that cannot settle it.

The suite's convention, which implementations SHOULD follow:

| rail | default facilitator | env override |
|---|---|---|
| evm | `https://x402.org/facilitator` | `FACILITATOR_URL` |
| solana | `https://facilitator.payai.network` | `SOLANA_FACILITATOR_URL` |

### 5.4 The challenge example

Include a real 402 body. This is the single highest-value block in the file, because a client
can be written against it with no guessing:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",
      "resource": "https://domains.example.com/check/example.com",
      "description": "Live RDAP lookup for one domain",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "outputSchema": { "input": { "…": "§5.5" }, "output": { "…": "§5.5" } },
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "1000",
      "resource": "https://domains.example.com/check/example.com",
      "description": "Live RDAP lookup for one domain",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "outputSchema": { "input": { "…": "§5.5" }, "output": { "…": "§5.5" } },
      "extra": {
        "name": "USD Coin",
        "decimals": 6,
        "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"
      }
    }
  ]
}
```

Notes a document SHOULD make explicit, because clients get them wrong:

- **`maxAmountRequired` is in the asset's base units.** USDC has six decimals, so `"1000"`
  is $0.001 and `"10000"` is $0.01. It is not dollars and it is not a float.
- **`extra` differs per rail.** On EVM it is the EIP-712 domain the wallet needs to build the
  `transferWithAuthorization` signature. On Solana it carries `decimals` and `feePayer` — the
  facilitator's sponsor account, which pays the SOL network fee so a buyer holding only USDC
  can still transact.
- **`resource` is the absolute URL being purchased**, path only. If the price does not vary
  with the query string, say so.
- **`outputSchema` is elided above only to keep the example readable.** In a real challenge it
  is spelled out in full on every entry — see §5.5.

### 5.5 The invocation contract (`outputSchema`)

Every accept entry SHOULD carry an `outputSchema` — the machine-readable half of what the rest
of this document says in prose. It is what lets an agent that has never seen the service
decide whether the call is worth the price and then make it correctly, from the challenge
alone, with no second fetch:

```json
"outputSchema": {
  "input": {
    "type": "http",
    "method": "GET",
    "queryParams": {
      "max": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 }
    },
    "pathParams": {
      "domain": { "type": "string", "description": "Registrable domain; IDNs punycode", "x-required": true }
    }
  },
  "output": {
    "type": "object",
    "required": ["domain", "status", "checkedAt"],
    "properties": {
      "domain": { "type": "string" },
      "status": { "type": "string", "enum": ["registered", "available", "unknown"] },
      "checkedAt": { "type": "string", "format": "date-time" }
    }
  }
}
```

- **`input`** describes how to build the request. `type` is `"http"` and `method` is the
  route's verb. Parameters are split by where they go: `queryParams` for the query string,
  `pathParams` for `:segments` in the path. A route with a body instead sets
  `bodyType: "json"` and lists its top-level fields in `bodyFields`. Every value is a JSON
  Schema for that one parameter or field; mark the mandatory ones `"x-required": true`, since
  a per-field schema has nowhere to put JSON Schema's document-level `required` array.
- **`output`** is the JSON Schema of the 200 body — the artifact being sold (§6.3), not a
  wrapper around it.

Two rules keep this honest:

1. **Derive both halves from the OpenAPI document, do not hand-write them.** The endpoint's
   `parameters` / `requestBody` become `input`; its `200` response schema becomes `output`,
   with `$ref`s resolved so the challenge stands alone. Discovery crawlers treat the runtime
   402 as authoritative, so a hand-maintained copy that drifts from the spec is worse than no
   copy at all.
2. **Every accept entry carries the same contract.** Which rail a buyer pays on cannot change
   what the endpoint accepts or returns, so `outputSchema` MUST be identical across the EVM
   and Solana entries.

Omitting `input` or `output` is what the x402scan discovery audit reports as
`SCHEMA_INPUT_MISSING` / `SCHEMA_OUTPUT_MISSING`, both **errors** — it is the difference
between a service an agent can find and one it can actually use.

### 5.6 The paywall answers first

**A paid route MUST return its 402 challenge before it validates the request or checks that
the thing being asked for exists.** An unpaid `GET /verify/no-such-id-123` or an unpaid
`POST /register` with an empty body is a *quote request*, not a malformed call, and the only
correct answer to it is the challenge.

A document SHOULD say so explicitly, because it is what makes a route probe-able:

```markdown
Every paid route answers an unpaid request with 402 regardless of what you send. A synthetic
id or an empty body still returns the challenge, so you can price a call before making it.
```

This is not a nicety. Discovery crawlers — and any agent deciding whether a service is worth
using — probe paid routes without paying to read the price and the contract. A route that
answers `404 NOT_FOUND` or `400 BAD_REQUEST` first looks broken rather than paid: x402scan
skips it, and the service can end up passing an audit while being unregisterable. It is also
an information leak, since a 404-before-402 tells an unpaying caller which ids exist.

In practice this is an ordering rule about middleware. The paywall must sit *above* every
paid handler, and the handler must assume it only ever runs on a settled request:

```ts
app.use(paywall(PAID_ROUTES, { … }));      // 402 for anything unpaid
app.get("/verify/:id", (req, res) => {      // only reached after settlement
  const record = store.get(req.params.id);
  if (!record) return res.status(404).json({ error: "NOT_FOUND" });
  …
});
```

A 404 for a genuinely unknown id is correct — *after* payment. Services that cannot charge for
a miss should validate cheaply and refund, or price the lookup as the search it is.

### 5.7 The receipt

A document SHOULD state that paid responses carry `X-PAYMENT-RESPONSE`: base64 JSON naming
the rail, network, transaction and payer. Agents use it to reconcile spend.

---

## 6. Endpoint sections

### 6.1 Heading grammar

```
## `METHOD /path` — price
```

Formally:

```
heading   = "##" WS "`" method WS path "`" WS dash WS price
method    = 1*UPPER                       ; GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
path      = "/" *VCHAR                    ; ":param" for path parameters
dash      = "—" / "–" / "-"
price     = "free" / "$" 1*DIGIT [ "." 1*DIGIT ]
```

Regex, as implemented:

```
/^##\s+`([A-Z]+)\s+(\/\S*)`\s*[—–-]\s*(free|\$\d+(?:\.\d+)?)\s*$/
```

Conformant:

```markdown
## `GET /check/:domain` — $0.001
## `POST /bounties` — $0.01
## `GET /skills.json` — free
```

Not conformant (each raises **SM008**):

```markdown
### POST /bounties — $0.01          ← level 3, and no backticks
## POST /bounties ($0.01)           ← price not after a dash
## `POST /bounties` — 1 cent        ← price not a literal
## `POST /bounties` — from $0.01    ← ranges are not prices (SM017)
```

Path parameters use `:name`, not `{name}`. A generator converting from OpenAPI MUST rewrite
`/check/{domain}` to `/check/:domain`.

### 6.2 Required content per endpoint

| requirement | rule |
|---|---|
| ≥ 20 characters of prose saying what the 200 body contains | SM010 (warning) |
| A fenced ` ```json ` block showing a real 200 body | SM009 (warning) |
| A parameter table, if the path has `:params` or examples show a query string | SM011 (warning) |
| A price matching the literal grammar | SM017 (warning) |

Parameter tables SHOULD use these columns:

```markdown
| name | in | type | required | notes |
|---|---|---|---|---|
| `domain` | path | string | yes | Registrable domain; IDNs must be punycode |
| `max` | query | integer | no | 1–20, default 5. Clamped, not rejected |
| `amount` | body | number | yes | Pledged bounty in USD |
```

`in` is one of `path`, `query`, `body`, `header`.

### 6.3 The 200 body is the product

The x402 suite's rule, which this format assumes: **every paid route returns the purchased
artifact in the 200 response body.** No job ids, no callbacks, nothing to poll. If a document
describes a paid route that returns only an acknowledgement, the design is wrong, not the
document — restructure it as pay-per-poll (return a snapshot now) or return a signed claim
instrument immediately.

The response example is what an agent plans against, so make it a *real* one. Paste actual
server output, do not hand-write plausible-looking values, and regenerate examples when the
shape changes.

---

## 7. Other sections

### 7.1 Free routes

A table of unpaid routes. Recommended, not required (**SM021**, info). It is how an agent
orients itself for nothing:

```markdown
| route | returns |
|---|---|
| `GET /` | service card: rails, prices, doc links |
| `GET /health` | `{ ok, uptime }` |
| `GET /skill.md` | this file |
| `GET /.well-known/x402` | machine-readable resource manifest |
| `GET /openapi.json` | OpenAPI 3.1 |
```

Free routes MAY instead be written as endpoint sections with price `free`.

### 7.2 Discovery links

A document SHOULD reference `/.well-known/x402` (**SM014**, warning) and `/openapi.json`
(**SM019**, info), and give a contact address (**SM015**, warning).

### 7.3 Data source

**If any response can be something other than live upstream data — a fixture, a cache, a
stub — the document MUST say so**, and responses SHOULD carry a `source` field naming which.
A document mentioning fixtures without a `## Data source` section raises **SM023**.

```markdown
| `source` | meaning |
|---|---|
| `podcastindex-live` | fetched from the upstream API at request time |
| `fixture` | this deployment has no credentials and served a deterministic sample |
```

This exists because a paid response that quietly returns canned data is fraud, and because
env-gated demos are otherwise genuinely useful — the honest version is to ship fixtures *and*
label them in every response.

---

## 8. Errors

A conformant document MUST have a section whose title begins with `Error` (**SM012**), and it
SHOULD document the 402 (**SM013**) — the response every paying client meets first.

```markdown
| status | body `error` | meaning |
|---|---|---|
| 400 | `INVALID_DOMAIN` | the path segment is not a valid domain |
| 402 | — | payment required or rejected; body is the dual-rail challenge |
| 502 | `RDAP_UPSTREAM_ERROR` | upstream failed |
```

A document SHOULD also list the 402 sub-reasons an agent can act on differently — an
unpaid first attempt, a malformed header, a rail the service does not take, and a
facilitator rejection are four different situations with four different retries.

Implementations SHOULD return a 5xx rather than a 402 when the *facilitator* is unreachable,
so a retry loop cannot mistake an outage for a price.

---

## 9. Rule catalogue

Severity: **error** — not conformant, an agent may fail to use the service. **warning** —
conformant but lossy, an agent has to guess. **info** — a suggestion.

Ids are stable forever. A rule may be retired; its id is never reused.

| id | severity | title |
|---|---|---|
| SM001 | error | Missing H1 title |
| SM002 | error | Missing summary paragraph |
| SM003 | error | Missing base URL |
| SM004 | error | Missing `## Payment` section |
| SM005 | error | No EVM payment rail documented |
| SM006 | error | No Solana payment rail documented |
| SM007 | error | No endpoints documented |
| SM008 | error | Endpoint heading does not match the grammar |
| SM009 | warning | Endpoint has no response example |
| SM010 | warning | Endpoint has no description |
| SM011 | warning | Endpoint takes parameters but does not document them |
| SM012 | error | Missing `## Errors` section |
| SM013 | warning | Errors section does not mention 402 |
| SM014 | warning | No link to the x402 manifest |
| SM015 | warning | No contact address |
| SM016 | warning | No `x402Version` / protocol version stated |
| SM017 | warning | Price is not a well-formed literal |
| SM018 | warning | No 402 challenge example |
| SM019 | info | No OpenAPI reference |
| SM020 | error | Placeholder text left in the document |
| SM021 | info | No free routes documented |
| SM022 | warning | Frontmatter is present but malformed |
| SM023 | info | Data provenance not documented |

Machine-readable, with the fix text for each: `GET /rules` on any deployment, or
`npx x402-skill-md rules --json`.

### 9.1 Scoring

A document scores out of 100, losing 12 per error, 4 per warning, 1 per info, floored at 0.
`valid` is `true` when there are **zero errors**, independent of score — the score is a
quality signal, `valid` is the gate.

---

## 10. Conformance

A **conformant SKILL-MD 1.0 document** triggers no rule of severity `error`.

A **conformant validator** implements every rule in §9 with the stated severities and reports
each finding with its rule id, a document-specific detail, and the remedy.

A **conformant generator** emits documents that its own validator passes, and warns —
without failing — when the source material lacks something the format wants (no summary, no
price, no response schema). Silently inventing a price would be worse than a warning.

---

## 11. Versioning

The version is `major.minor`, declared in frontmatter as `skillMd`.

- **Minor** bumps add rules or optional structure. A 1.0 document stays conformant under
  1.1; new rules arrive at `warning` or `info` severity, never `error`.
- **Major** bumps may change the section grammar or promote a rule to `error`.

A document with no frontmatter is assumed to be 1.0. Validators SHOULD accept documents
declaring a *newer* minor version and validate them against the rules they know.

---

## 12. A minimal conformant document

Every rule satisfied, nothing extra:

````markdown
---
skillMd: "1.0"
name: example-service
---

# example-service

Returns the current UTC time as a signed timestamp, so an agent can prove it asked at a
particular moment. One paid route, one free route, no account required.

- **Base URL:** `https://example.com`
- **Manifest:** `GET /.well-known/x402`
- **OpenAPI:** `GET /openapi.json`
- **Contact:** ops@example.com

## Payment

x402 v1, scheme `exact`. Unpaid requests get a 402 whose `accepts` array lists both rails —
USDC on Base and USDC on Solana. Your client picks.

| rail | network | payTo | facilitator |
|---|---|---|---|
| evm | `base-sepolia` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| solana | `solana` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "resource": "https://example.com/now", "mimeType": "application/json",
      "maxTimeoutSeconds": 60, "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "resource": "https://example.com/now", "mimeType": "application/json",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" } }
  ]
}
```

Amounts are USDC base units — `"1000"` is $0.001. Paid responses carry an
`X-PAYMENT-RESPONSE` receipt.

## `GET /now` — $0.001

The current UTC time with an HMAC signature over it, in this response body.

```json
{ "now": "2026-08-07T12:00:00.000Z", "signature": "9f2c…" }
```

## Free routes

| route | returns |
|---|---|
| `GET /health` | `{ ok, uptime }` |
| `GET /.well-known/x402` | machine-readable resource manifest |
| `GET /openapi.json` | OpenAPI 3.1 |

## Errors

| status | meaning |
|---|---|
| 402 | payment required or rejected; body is the dual-rail challenge |
| 500 | signing failed |
````

Check any document against this specification:

```bash
npx x402-skill-md validate skill.md
npx x402-skill-md validate skill.md --json --strict
```

---

*SKILL-MD 1.0 · maintained alongside the [x402 Suite](https://github.com/nirholas/x402-suite)
· corrections to nichxbt@gmail.com*
