/**
 * validate.ts — check a skill.md against the SKILL-MD format and say how to fix it.
 *
 * Every finding carries the rule id, its severity, where it is, and the exact
 * remedy from the rule catalogue. The report is the product: a validator that
 * only says "invalid" is not worth paying for.
 */
import { findSection, parseSkillMd, type ParsedSkill } from "./parse.js";
import {
  PRICE_LITERAL,
  RULES,
  SEVERITY_WEIGHT,
  SKILL_MD_VERSION,
  type Severity,
} from "./spec.js";

export interface Finding {
  rule: string;
  severity: Severity;
  title: string;
  /** What was actually wrong, in this document. */
  detail: string;
  fix: string;
  /** 1-based line, when the problem has a location. */
  line?: number;
}

export interface ValidationReport {
  skillMdVersion: string;
  valid: boolean;
  score: number;
  summary: { errors: number; warnings: number; infos: number };
  service: {
    name: string | null;
    baseUrl: string | null;
    contact: string | null;
    endpoints: { method: string; path: string; price: string }[];
    rails: { evm: boolean; solana: boolean };
    dualRail: boolean;
  };
  findings: Finding[];
  checkedAt: string;
}

const EVM_NETWORK = /\b(base-sepolia|base)\b/;
const SOLANA_NETWORK = /\b(solana-devnet|solana)\b/;
const EVM_ADDRESS = /\b0x[0-9a-fA-F]{40}\b/;
const SOLANA_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const PLACEHOLDER = /\b(TODO|FIXME|TBD|XXX)\b|<(your[- ]?\w+|placeholder|fill[- ]?me)>/i;
const BASE_URL_LINE = /base\s*url/i;
const URL_IN_LINE = /(https?:\/\/[^\s`<>()]+|`[^`]*localhost:\d+[^`]*`)/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

function url(line: string): string | null {
  const m = line.match(URL_IN_LINE);
  return m ? m[1].replace(/[`,.]+$/, "").replace(/^`/, "") : null;
}

/** Validate an already-parsed document. */
export function validateParsed(doc: ParsedSkill): ValidationReport {
  const findings: Finding[] = [];
  const add = (ruleId: string, detail: string, line?: number): void => {
    const rule = RULES[ruleId];
    findings.push({
      rule: rule.id,
      severity: rule.severity,
      title: rule.title,
      detail,
      fix: rule.fix,
      ...(line ? { line } : {}),
    });
  };

  // ---- frontmatter --------------------------------------------------------
  if (doc.frontmatterMalformed) {
    add("SM022", "The document starts with `---` but the frontmatter block is not well formed.", 1);
  }

  // ---- title + intro ------------------------------------------------------
  if (!doc.title) {
    add("SM001", "No `# heading` was found anywhere in the document.");
  }
  if (doc.intro.length < 40) {
    add(
      "SM002",
      doc.intro
        ? `The text under the title is only ${doc.intro.length} characters — too short to tell an agent what this service does.`
        : "There is no prose between the title and the first section.",
      doc.titleLine || undefined,
    );
  }

  // ---- base URL, manifest, openapi, contact -------------------------------
  const baseUrlLine = doc.lines.find((l) => BASE_URL_LINE.test(l) && URL_IN_LINE.test(l));
  const baseUrl = baseUrlLine ? url(baseUrlLine) : null;
  if (!baseUrl) add("SM003", "No line documents a base URL with a resolvable URL on it.");

  if (!/\.well-known\/x402/.test(doc.raw)) {
    add("SM014", "The string `/.well-known/x402` does not appear anywhere in the document.");
  }
  if (!/openapi\.json/i.test(doc.raw)) {
    add("SM019", "No reference to `/openapi.json`.");
  }
  const contactMatch = doc.raw.match(EMAIL);
  const contact = contactMatch ? contactMatch[0] : null;
  if (!contact && !/\bcontact\b/i.test(doc.raw)) {
    add("SM015", "No contact email or contact line found.");
  }

  // ---- placeholders -------------------------------------------------------
  for (let i = 0; i < doc.lines.length; i++) {
    if (PLACEHOLDER.test(doc.lines[i])) {
      add("SM020", `Line ${i + 1} still contains placeholder text: ${doc.lines[i].trim().slice(0, 80)}`, i + 1);
      break; // one finding is enough to make the point
    }
  }

  // ---- payment ------------------------------------------------------------
  const payment = findSection(doc, "payment");
  let evmRail = false;
  let solanaRail = false;

  if (!payment) {
    add("SM004", "No `## Payment` section.");
    add("SM005", "There is no Payment section, so no EVM rail is documented.");
    add("SM006", "There is no Payment section, so no Solana rail is documented.");
    add("SM018", "There is no Payment section, so there is no 402 challenge example.");
  } else {
    const body = payment.body;
    evmRail = EVM_NETWORK.test(body) && EVM_ADDRESS.test(body);
    // Guard against an EVM address being read as base58 — check a line that
    // actually mentions a Solana network.
    solanaRail =
      SOLANA_NETWORK.test(body) &&
      body
        .split("\n")
        .some((l) => SOLANA_NETWORK.test(l) || SOLANA_ADDRESS.test(l.replace(EVM_ADDRESS, "")));

    if (!evmRail) {
      add(
        "SM005",
        EVM_NETWORK.test(body)
          ? "An EVM network is named but no `0x…` payTo address appears in the Payment section."
          : "No EVM network (`base` / `base-sepolia`) is named in the Payment section.",
        payment.line,
      );
    }
    if (!solanaRail) {
      add(
        "SM006",
        SOLANA_NETWORK.test(body)
          ? "A Solana network is named but no base58 payTo address appears in the Payment section."
          : "No Solana network (`solana` / `solana-devnet`) is named in the Payment section.",
        payment.line,
      );
    }
    if (!/x402\s*v?1|x402Version/i.test(body)) {
      add("SM016", "The Payment section does not state the x402 protocol version.", payment.line);
    }
    const hasChallenge =
      /```json/i.test(body) && /"?accepts"?\s*:/.test(body) && /402|x402Version/.test(body);
    if (!hasChallenge) {
      add(
        "SM018",
        "No fenced JSON block in the Payment section shows a 402 body with an `accepts` array.",
        payment.line,
      );
    }
  }

  // ---- endpoints ----------------------------------------------------------
  for (const bad of doc.malformedEndpointHeadings) {
    add(
      "SM008",
      `\`## ${bad.text}\` names an HTTP method but does not match the endpoint grammar.`,
      bad.line,
    );
  }

  if (doc.endpoints.length === 0) {
    add("SM007", "No level-2 heading matches the endpoint grammar.");
  }

  for (const ep of doc.endpoints) {
    const label = `\`${ep.method} ${ep.path}\``;
    if (!PRICE_LITERAL.test(ep.price)) {
      add("SM017", `${label} has price "${ep.price}", which is not \`$amount\` or \`free\`.`, ep.line);
    }
    if (ep.description.length < 20) {
      add("SM010", `${label} has no prose describing what the 200 body contains.`, ep.line);
    }
    if (!ep.hasJsonExample) {
      add("SM009", `${label} has no fenced JSON response example.`, ep.line);
    }
    const takesParams = /:[A-Za-z_]\w*/.test(ep.path) || /\?\w+=/.test(ep.body);
    if (takesParams && !ep.hasTable) {
      add(
        "SM011",
        `${label} has path or query parameters but no parameter table.`,
        ep.line,
      );
    }
  }

  // ---- errors -------------------------------------------------------------
  const errors = findSection(doc, "error");
  if (!errors) {
    add("SM012", "No `## Errors` section.");
  } else if (!/\b402\b/.test(errors.body)) {
    add("SM013", "The Errors section never mentions the 402 response.", errors.line);
  }

  // ---- nice-to-haves ------------------------------------------------------
  if (!findSection(doc, "free route") && !/\bfree\b/i.test(doc.raw)) {
    add("SM021", "No free routes are documented.");
  }
  const mentionsFixtures = /\bfixture|\bcached?\b|\bstub\b/i.test(doc.raw);
  if (mentionsFixtures && !findSection(doc, "data source")) {
    add(
      "SM023",
      "The document mentions fixtures or caching but has no `## Data source` section explaining when a response is not live.",
    );
  }

  // ---- score --------------------------------------------------------------
  const summary = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
  };
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    skillMdVersion: SKILL_MD_VERSION,
    valid: summary.errors === 0,
    score,
    summary,
    service: {
      name: doc.title,
      baseUrl,
      contact,
      endpoints: doc.endpoints.map((e) => ({ method: e.method, path: e.path, price: e.price })),
      rails: { evm: evmRail, solana: solanaRail },
      dualRail: evmRail && solanaRail,
    },
    findings,
    checkedAt: new Date().toISOString(),
  };
}

/** Validate raw skill.md text. */
export function validateSkillMd(raw: string): ValidationReport {
  return validateParsed(parseSkillMd(raw));
}

/** Render a report the way the CLI prints it. */
export function formatReport(report: ValidationReport): string {
  const out: string[] = [];
  const icon: Record<Severity, string> = { error: "✗", warning: "!", info: "·" };
  out.push(
    `${report.valid ? "PASS" : "FAIL"}  score ${report.score}/100  ` +
      `(${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos)`,
  );
  out.push(
    `service: ${report.service.name ?? "(unnamed)"}  ` +
      `endpoints: ${report.service.endpoints.length}  ` +
      `rails: ${report.service.dualRail ? "evm + solana" : [
        report.service.rails.evm ? "evm" : null,
        report.service.rails.solana ? "solana" : null,
      ].filter(Boolean).join(" + ") || "none"}`,
  );
  if (report.findings.length === 0) {
    out.push("\nNo findings. This document is conformant.");
    return out.join("\n");
  }
  out.push("");
  for (const f of report.findings) {
    out.push(`${icon[f.severity]} ${f.rule}${f.line ? ` (line ${f.line})` : ""}  ${f.title}`);
    out.push(`    ${f.detail}`);
    out.push(`    fix: ${f.fix}`);
  }
  return out.join("\n");
}
