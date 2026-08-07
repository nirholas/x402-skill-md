/**
 * examples/agent-client.ts — generate a skill.md, then validate it, paid.
 *
 *   PRIVATE_KEY=0x… npm run client
 *   PRIVATE_KEY=0x… OPENAPI=./path/to/openapi.json npm run client
 *
 * `wrapFetchWithPayment` catches each 402, picks the EVM requirement out of the
 * dual-rail `accepts` array, signs an EIP-3009 authorisation for the exact
 * amount, and retries with `X-PAYMENT`. The Solana rail is shown at the bottom.
 */
import { readFileSync } from "node:fs";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4029";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

/** A tiny but complete OpenAPI document, used when none is supplied. */
const SAMPLE_OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "example-service",
    summary:
      "Returns the current UTC time as a signed timestamp, so an agent can prove it asked at a particular moment.",
    contact: { email: "ops@example.com" },
  },
  servers: [{ url: "https://example.com" }],
  paths: {
    "/now": {
      get: {
        operationId: "getNow",
        summary: "Current UTC time, signed",
        description: "The current UTC time with an HMAC signature over it, in this response body.",
        "x-x402": { price: "$0.001" },
        responses: {
          "200": {
            description: "The signed timestamp.",
            content: {
              "application/json": {
                example: { now: "2026-08-07T12:00:00.000Z", signature: "9f2c…" },
              },
            },
          },
          "402": { description: "Payment required." },
        },
      },
    },
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "Liveness probe (free)",
        responses: { "200": { description: "OK" } },
      },
    },
  },
};

function loadOpenapi(): Record<string, unknown> {
  const path = process.env.OPENAPI;
  if (!path) return SAMPLE_OPENAPI;
  return JSON.parse(readFileSync(path, "utf8"));
}

async function showChallenge(): Promise<void> {
  console.log(`\n① Unpaid request → expect a dual-rail 402\n   POST ${BASE_URL}/generate`);
  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SAMPLE_OPENAPI),
  });
  const body = await res.json();
  console.log(`   HTTP ${res.status}`);
  for (const a of body.accepts ?? []) {
    console.log(
      `   accepts: ${String(a.network).padEnd(14)} ${a.maxAmountRequired} base units USDC → ${a.payTo}`,
    );
  }
}

async function main(): Promise<void> {
  // The rule catalogue is free — see what you'll be judged against first.
  const rules = await (await fetch(`${BASE_URL}/rules`)).json();
  console.log(`SKILL-MD ${rules.skillMdVersion} — ${rules.count} rules, catalogue is free at GET /rules`);
  console.log(
    `errors: ${rules.rules.filter((r: { severity: string }) => r.severity === "error").length}, ` +
      `warnings: ${rules.rules.filter((r: { severity: string }) => r.severity === "warning").length}, ` +
      `infos: ${rules.rules.filter((r: { severity: string }) => r.severity === "info").length}`,
  );

  await showChallenge();

  if (!PRIVATE_KEY) {
    console.log(
      "\nSet PRIVATE_KEY to a funded Base Sepolia wallet to complete the purchase." +
        "\nTestnet USDC faucet: https://faucet.circle.com\n" +
        "\nOr skip payment entirely and use the library:  npx x402-skill-md generate openapi.json\n",
    );
    return;
  }

  const chain = process.env.NETWORK === "base" ? base : baseSepolia;
  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport: http() }).extend(publicActions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pay = wrapFetchWithPayment(fetch, wallet as any);

  console.log(`\n② Generating from ${account.address} on ${chain.name} — $0.01`);
  const generated = await pay(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ openapi: loadOpenapi() }),
  });
  const result = await generated.json();
  if (!generated.ok) throw new Error(`generate failed: ${generated.status} ${JSON.stringify(result)}`);

  console.log(
    `\n③ 200 — ${result.service.name}: ${result.service.paid} paid of ${result.service.endpoints} endpoints`,
  );
  console.log(
    `   generated file scores ${result.validation.score}/100, valid: ${result.validation.valid}`,
  );
  for (const w of result.warnings ?? []) console.log(`   warning: ${w}`);
  console.log("\n--- skill.md ---");
  console.log(result.skillMd);
  console.log("--- end ---");

  const r1 = generated.headers.get("x-payment-response");
  if (r1) console.log("\n   X-PAYMENT-RESPONSE:", decodeXPaymentResponse(r1));

  // --- validate something deliberately broken, to see the fixes -----------
  const broken = "# broken-service\n\nToo short.\n\n## `GET /thing` — 1 cent\n";
  console.log(`\n④ Validating a deliberately broken document — $0.002`);
  const checked = await pay(`${BASE_URL}/validate`, {
    method: "POST",
    headers: { "content-type": "text/markdown" },
    body: broken,
  });
  const report = await checked.json();
  console.log(
    `   valid: ${report.valid}  score: ${report.score}/100  ` +
      `(${report.summary.errors} errors, ${report.summary.warnings} warnings)`,
  );
  for (const f of report.findings) {
    console.log(`   ${f.severity === "error" ? "✗" : f.severity === "warning" ? "!" : "·"} ${f.rule} ${f.title}`);
    console.log(`       ${f.detail}`);
    console.log(`       fix: ${f.fix}`);
  }
  console.log(
    "\n   Note this was a 200, not a 4xx. A non-conformant document is a successful report —" +
      "\n   you bought the findings, and the findings are the artifact.",
  );
}

main().catch((err) => {
  console.error("\nfailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Paying on the SOLANA rail instead
 * ---------------------------------------------------------------------------
 *   import {
 *     prepareSolanaCheckout,
 *     encodeX402Payment,
 *   } from "@three-ws/x402-payment-modal/server";
 *
 *   const url       = `${BASE_URL}/validate`;
 *   const challenge = await (await fetch(url, { method: "POST", body: "# x" })).json();
 *   const accept    = challenge.accepts.find((a: any) => a.network.startsWith("solana"));
 *
 *   const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPubkey });
 *   const signed        = await wallet.signTransaction(tx_base64);   // Phantom, Solflare, a keypair
 *   const { x_payment } = encodeX402Payment({ accept, signedTxBase64: signed, resourceUrl: url });
 *
 *   await fetch(url, {
 *     method: "POST",
 *     headers: { "content-type": "text/markdown", "X-PAYMENT": x_payment },
 *     body: mySkillMd,
 *   });
 *
 * Those helpers only build and encode the payment client-side; verification and
 * settlement happen server-side through the rail's facilitator.
 * `accept.extra.feePayer` sponsors the SOL network fee, so the buyer spends USDC only.
 *
 * ---------------------------------------------------------------------------
 * No wallet? The same logic ships as a library and a CLI.
 * ---------------------------------------------------------------------------
 *   npm i x402-skill-md
 *
 *   import { openapiToSkillMd, validateSkillMd } from "x402-skill-md";
 *   const { skillMd } = openapiToSkillMd(JSON.parse(readFileSync("openapi.json", "utf8")));
 *   console.log(validateSkillMd(skillMd).valid);   // true
 *
 *   npx x402-skill-md generate openapi.json -o skill.md
 *   npx x402-skill-md validate skill.md --strict
 */
