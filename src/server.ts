import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  paywall,
  activeRails,
  usingSuiteDefaultPayTo,
  paymentReceipt,
  type RoutePrices,
} from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import { openapiToSkillMd } from "./generate.js";
import { validateSkillMd } from "./validate.js";
import { RULES, SKILL_MD_VERSION, DEFAULT_RAILS } from "./spec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 4029);

const PAID_ROUTES: RoutePrices = {
  "POST /generate": "$0.01",
  "POST /validate": "$0.002",
};

const DESCRIPTIONS: Record<string, string> = {
  "POST /generate": "Generate a conformant skill.md from a posted OpenAPI document",
  "POST /validate": "Validate a posted skill.md and return a report with per-finding fixes",
};

const PRICE_TABLE = [
  { route: "POST /generate", price: "$0.01" },
  { route: "POST /validate", price: "$0.002" },
  { route: "GET /rules", price: "free" },
  { route: "GET /spec", price: "free" },
];

const app = express();
app.disable("x-powered-by");
// Generated skill.md files and the OpenAPI documents they come from are big.
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: ["text/markdown", "text/plain"], limit: "2mb" }));

// ---- free routes ----
app.get("/", (_req, res) => {
  res.json({
    name: "x402-skill-md",
    description:
      "The skill.md toolkit: generate and validate agent-discoverable skill files from OpenAPI specs",
    skillMdVersion: SKILL_MD_VERSION,
    docs: "https://nirholas.github.io/x402-skill-md/",
    spec: "https://nirholas.github.io/x402-skill-md/spec",
    library: "npm i x402-skill-md",
    cli: "npx x402-skill-md generate openapi.json",
    skill: "/skill.md",
    manifest: "/.well-known/x402",
    openapi: "/openapi.json",
    payment: {
      protocol: "x402",
      note: "Pay in USDC on Base or Solana — your client picks the rail.",
      rails: activeRails(),
    },
    endpoints: PRICE_TABLE,
  });
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), skillMdVersion: SKILL_MD_VERSION }),
);

/** The rule catalogue — free, so a client knows what it is being judged against. */
app.get("/rules", (_req, res) => {
  res.json({
    skillMdVersion: SKILL_MD_VERSION,
    count: Object.keys(RULES).length,
    rules: Object.values(RULES),
  });
});

/** The format specification itself, as Markdown. */
app.get("/spec", (_req, res) =>
  res.type("text/markdown").sendFile(path.join(ROOT, "docs", "spec.md")),
);

app.get("/.well-known/x402", (_req, res) =>
  res.type("application/json").sendFile(path.join(ROOT, "public", ".well-known", "x402")),
);
app.get("/skill.md", (_req, res) => res.type("text/markdown").sendFile(path.join(ROOT, "skill.md")));
app.get("/openapi.json", (_req, res) => res.sendFile(path.join(ROOT, "openapi.json")));
app.use(express.static(path.join(ROOT, "public")));

// ---- paywall: everything below this line costs USDC ----
app.use(paywall(PAID_ROUTES, { service: "x402-skill-md", descriptions: DESCRIPTIONS, schemas: ROUTE_SCHEMAS }));

/**
 * POST /generate — $0.01
 * Body: the OpenAPI document itself, or `{ openapi: <doc>, options: {...} }`.
 * The generated skill.md is returned in this response, together with the
 * validation report for it, so one call gives you a file you can ship.
 */
app.post("/generate", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "POST the OpenAPI document as JSON, or { openapi: <doc>, options: {...} }",
      });
      return;
    }
    const doc = (body.openapi && typeof body.openapi === "object" ? body.openapi : body) as Record<
      string,
      unknown
    >;
    const options = (body.options ?? {}) as Record<string, unknown>;

    if (!doc.paths || typeof doc.paths !== "object") {
      res.status(400).json({
        error: "NOT_AN_OPENAPI_DOCUMENT",
        message: "The posted JSON has no `paths` object — it does not look like an OpenAPI document.",
      });
      return;
    }

    const result = openapiToSkillMd(doc, { rails: DEFAULT_RAILS, ...options });
    const report = validateSkillMd(result.skillMd);

    res.json({
      skillMdVersion: SKILL_MD_VERSION,
      skillMd: result.skillMd,
      service: result.service,
      warnings: result.warnings,
      validation: {
        valid: report.valid,
        score: report.score,
        summary: report.summary,
        findings: report.findings,
      },
      generatedAt: new Date().toISOString(),
      receipt: paymentReceipt(res),
    });
  } catch (err) {
    res.status(400).json({ error: "GENERATE_FAILED", message: (err as Error).message });
  }
});

/**
 * POST /validate — $0.002
 * Body: raw markdown (`text/markdown`) or `{ skillMd: "..." }`.
 * Returns the full report: findings, fixes, score, and what was understood
 * about the service.
 */
app.post("/validate", (req, res) => {
  try {
    const raw =
      typeof req.body === "string"
        ? req.body
        : typeof (req.body as Record<string, unknown>)?.skillMd === "string"
          ? ((req.body as Record<string, string>).skillMd)
          : null;

    if (!raw || !raw.trim()) {
      res.status(400).json({
        error: "BAD_REQUEST",
        message:
          'POST the file as text/markdown, or as JSON { "skillMd": "# my-service\\n..." }',
      });
      return;
    }

    const report = validateSkillMd(raw);
    res.json({ ...report, receipt: paymentReceipt(res) });
  } catch (err) {
    res.status(400).json({ error: "VALIDATE_FAILED", message: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`\nx402-skill-md listening on http://localhost:${PORT}`);
  console.log(`SKILL-MD format version ${SKILL_MD_VERSION} · ${Object.keys(RULES).length} rules`);
  console.log("Payment rails (USDC — the client picks):");
  for (const r of activeRails()) {
    console.log(`  ${r.rail.padEnd(7)} ${r.network.padEnd(14)} → ${r.payTo}  via ${r.facilitator}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself",
    );
  }
  console.log("Routes:");
  for (const r of PRICE_TABLE) console.log(`  ${r.route.padEnd(22)} ${r.price}`);
  console.log(
    "Free discovery: GET /  /health  /rules  /spec  /skill.md  /.well-known/x402  /openapi.json\n",
  );
});
