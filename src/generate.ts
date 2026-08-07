/**
 * generate.ts — OpenAPI 3.x → skill.md.
 *
 * The output is a conformant SKILL-MD 1.0 document: title, summary, the service
 * card, a dual-rail Payment section built from the declared rails, one section
 * per operation with parameters and a response example, free routes, and an
 * error table assembled from the spec's own response codes.
 *
 * Pricing comes from, in order of preference:
 *   1. `x-x402.price` on the operation  (`"$0.001"`)
 *   2. a 402 response example's `accepts[].maxAmountRequired`, converted from
 *      USDC base units
 *   3. `defaultPrice` from the options
 *   4. `free` — an operation with no 402 response is assumed free
 */
import { DEFAULT_RAILS, SKILL_MD_VERSION, type Rail } from "./spec.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

export interface GenerateOptions {
  /** Overrides `servers[0].url`. */
  baseUrl?: string;
  /** Overrides `info.contact.email`. */
  contact?: string;
  /** Payment rails to document. Defaults to the suite's dual-rail pair. */
  rails?: Rail[];
  /** Price for operations that declare a 402 but no amount. */
  defaultPrice?: string;
  /** Emit the optional YAML frontmatter block. Default true. */
  frontmatter?: boolean;
  /** Path to the x402 manifest. Default `/.well-known/x402`. */
  manifestPath?: string;
  /** Path to the OpenAPI document. Default `/openapi.json`. */
  openapiPath?: string;
}

export interface GenerateResult {
  skillMd: string;
  service: { name: string; baseUrl: string; endpoints: number; paid: number };
  warnings: string[];
}

const USDC_DECIMALS = 6;

/** `"1000"` → `"$0.001"`. Trailing zeros are trimmed but never below 2 dp. */
function baseUnitsToUsd(amount: string): string | null {
  if (!/^\d+$/.test(amount)) return null;
  const n = Number(amount) / 10 ** USDC_DECIMALS;
  if (!Number.isFinite(n)) return null;
  const fixed = n.toFixed(6).replace(/0+$/, "");
  return `$${fixed.endsWith(".") ? `${fixed}00` : fixed.split(".")[1].length < 2 ? n.toFixed(2) : fixed}`;
}

function deref(doc: Json, node: any): any {
  let seen = 0;
  while (node && typeof node === "object" && typeof node.$ref === "string" && seen++ < 10) {
    const path = node.$ref.replace(/^#\//, "").split("/");
    let cur: any = doc;
    for (const p of path) cur = cur?.[p.replace(/~1/g, "/").replace(/~0/g, "~")];
    node = cur;
  }
  return node;
}

/** Best available example for a response: `example`, `examples`, or a schema sketch. */
function responseExample(doc: Json, response: Json): string | null {
  const content = deref(doc, response)?.content?.["application/json"];
  if (!content) return null;
  if (content.example !== undefined) return JSON.stringify(content.example, null, 2);
  const first = content.examples && Object.values(content.examples)[0];
  if (first && (first as Json).value !== undefined) {
    return JSON.stringify((first as Json).value, null, 2);
  }
  const schema = deref(doc, content.schema);
  if (schema) {
    const sketch = sketchFromSchema(doc, schema, 0);
    if (sketch !== undefined) return JSON.stringify(sketch, null, 2);
  }
  return null;
}

/** Build an illustrative object from a JSON Schema — types, not fabricated values. */
function sketchFromSchema(doc: Json, schema: Json, depth: number): unknown {
  if (depth > 4) return "…";
  schema = deref(doc, schema);
  if (!schema || typeof schema !== "object") return "…";
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;
  if (schema.enum?.length) return schema.enum[0];
  switch (type) {
    case "object": {
      const out: Json = {};
      const props = schema.properties ?? {};
      for (const [key, value] of Object.entries(props).slice(0, 12)) {
        out[key] = sketchFromSchema(doc, value as Json, depth + 1);
      }
      return out;
    }
    case "array":
      return [sketchFromSchema(doc, schema.items ?? {}, depth + 1)];
    case "integer":
      return 0;
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      return schema.format === "date-time" ? "2026-01-01T00:00:00.000Z" : `<${schema.format ?? "string"}>`;
    default:
      if (schema.properties) return sketchFromSchema(doc, { ...schema, type: "object" }, depth);
      return "…";
  }
}

/** Price for one operation, plus a warning if we had to guess. */
function priceFor(
  doc: Json,
  op: Json,
  opts: GenerateOptions,
  warnings: string[],
  label: string,
): string {
  const declared = op["x-x402"]?.price ?? op["x-402"]?.price;
  if (typeof declared === "string") return declared;

  const challenge = op.responses?.["402"];
  if (!challenge) return "free";

  const example = deref(doc, challenge)?.content?.["application/json"]?.example;
  const amount = example?.accepts?.[0]?.maxAmountRequired;
  if (typeof amount === "string") {
    const usd = baseUnitsToUsd(amount);
    if (usd) return usd;
  }

  if (opts.defaultPrice) {
    warnings.push(
      `${label}: no \`x-x402.price\` and no 402 example amount — used defaultPrice ${opts.defaultPrice}. ` +
        "Add `x-x402: { price: \"$0.001\" }` to the operation to make this exact.",
    );
    return opts.defaultPrice;
  }
  warnings.push(
    `${label}: declares a 402 response but no price could be determined. ` +
      'Add `x-x402: { price: "$0.001" }` to the operation, or pass defaultPrice.',
  );
  return "$0.001";
}

/** `/check/{domain}` → `/check/:domain` — the form skill.md headings use. */
function toColonPath(p: string): string {
  return p.replace(/\{([^}]+)\}/g, ":$1");
}

function paramTable(doc: Json, op: Json, pathItem: Json): string {
  const params: Json[] = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]
    .map((p) => deref(doc, p))
    .filter(Boolean);
  const body = deref(doc, op.requestBody);
  const bodySchema = deref(doc, body?.content?.["application/json"]?.schema);

  if (params.length === 0 && !bodySchema) return "";

  const rows: string[] = [
    "| name | in | type | required | notes |",
    "|---|---|---|---|---|",
  ];
  for (const p of params) {
    const schema = deref(doc, p.schema) ?? {};
    const type = Array.isArray(schema.type) ? schema.type.join(" \\| ") : (schema.type ?? "string");
    const notes = [p.description, schema.enum ? `one of ${schema.enum.join(", ")}` : null]
      .filter(Boolean)
      .join(". ")
      .replace(/\|/g, "\\|")
      .replace(/\n+/g, " ");
    rows.push(`| \`${p.name}\` | ${p.in} | ${type} | ${p.required ? "yes" : "no"} | ${notes || "—"} |`);
  }
  if (bodySchema?.properties) {
    const required: string[] = bodySchema.required ?? [];
    for (const [name, raw] of Object.entries(bodySchema.properties)) {
      const schema = deref(doc, raw as Json) ?? {};
      const type = Array.isArray(schema.type) ? schema.type.join(" \\| ") : (schema.type ?? "string");
      const notes = String(schema.description ?? "—").replace(/\|/g, "\\|").replace(/\n+/g, " ");
      rows.push(`| \`${name}\` | body | ${type} | ${required.includes(name) ? "yes" : "no"} | ${notes} |`);
    }
  }
  return `**Parameters**\n\n${rows.join("\n")}\n`;
}

function railsTable(rails: Rail[]): string {
  const rows = [
    "| rail | network | asset | payTo | facilitator |",
    "|---|---|---|---|---|",
    ...rails.map(
      (r) =>
        `| ${r.rail} | \`${r.network}\` | ${r.asset} \`${r.assetAddress}\` | \`${r.payTo}\` | \`${r.facilitator}\` |`,
    ),
  ];
  return rows.join("\n");
}

/** A concrete 402 body for the documented rails, at the given price. */
function challengeExample(rails: Rail[], price: string, resource: string, description: string): string {
  const amount =
    price === "free" ? "0" : String(Math.round(Number(price.replace("$", "")) * 10 ** USDC_DECIMALS));
  const accepts = rails.map((r) => ({
    scheme: "exact",
    network: r.network,
    maxAmountRequired: amount,
    resource,
    description,
    mimeType: "application/json",
    payTo: r.payTo,
    maxTimeoutSeconds: 60,
    asset: r.assetAddress,
    extra:
      r.rail === "solana"
        ? { name: "USD Coin", decimals: 6, ...(r.feePayer ? { feePayer: r.feePayer } : {}) }
        : { name: "USDC", version: "2" },
  }));
  return JSON.stringify(
    { x402Version: 1, error: "X-PAYMENT header is required", accepts },
    null,
    2,
  );
}

/** Generate a conformant skill.md from an OpenAPI 3.x document. */
export function openapiToSkillMd(openapi: Json, options: GenerateOptions = {}): GenerateResult {
  const warnings: string[] = [];
  const opts: Required<Pick<GenerateOptions, "manifestPath" | "openapiPath" | "frontmatter">> &
    GenerateOptions = {
    manifestPath: "/.well-known/x402",
    openapiPath: "/openapi.json",
    frontmatter: true,
    ...options,
  };

  if (!openapi || typeof openapi !== "object") {
    throw new Error("openapi must be a parsed OpenAPI document object");
  }
  if (!openapi.openapi && !openapi.swagger) {
    warnings.push("Document has no `openapi` version field — treating it as OpenAPI 3.x anyway.");
  }

  const info: Json = openapi.info ?? {};
  const name = String(info.title ?? "unnamed-service").trim();
  const baseUrl =
    opts.baseUrl ?? (Array.isArray(openapi.servers) && openapi.servers[0]?.url) ?? "http://localhost:4021";
  const contact = opts.contact ?? info.contact?.email ?? info.contact?.url ?? null;
  const rails = opts.rails ?? DEFAULT_RAILS;
  const summary = String(info.summary ?? info.description ?? "").trim();

  if (!summary) {
    warnings.push(
      "`info.summary` and `info.description` are both empty — the generated summary paragraph is a stub you should replace.",
    );
  }
  if (!rails.some((r) => r.rail === "evm") || !rails.some((r) => r.rail === "solana")) {
    warnings.push(
      "The rails you passed are not dual-rail. A conformant skill.md documents both an EVM and a Solana rail (rule SM005/SM006).",
    );
  }

  // ---- operations ---------------------------------------------------------
  interface Op {
    method: string;
    path: string;
    price: string;
    op: Json;
    pathItem: Json;
  }
  const ops: Op[] = [];
  const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
  for (const [rawPath, rawItem] of Object.entries(openapi.paths ?? {})) {
    const pathItem = deref(openapi, rawItem) as Json;
    for (const method of METHODS) {
      const op = pathItem?.[method];
      if (!op) continue;
      const label = `${method.toUpperCase()} ${rawPath}`;
      ops.push({
        method: method.toUpperCase(),
        path: toColonPath(rawPath),
        price: priceFor(openapi, op, opts, warnings, label),
        op,
        pathItem,
      });
    }
  }
  if (ops.length === 0) warnings.push("The document declares no paths — the generated file has no endpoints.");

  const paid = ops.filter((o) => o.price !== "free");
  const free = ops.filter((o) => o.price === "free");

  // ---- document -----------------------------------------------------------
  const out: string[] = [];

  if (opts.frontmatter) {
    out.push("---");
    out.push(`skillMd: "${SKILL_MD_VERSION}"`);
    out.push(`name: ${name}`);
    out.push(`baseUrl: ${baseUrl}`);
    out.push(`manifest: ${opts.manifestPath}`);
    out.push(`openapi: ${opts.openapiPath}`);
    if (contact) out.push(`contact: ${contact}`);
    out.push("---");
    out.push("");
  }

  out.push(`# ${name}`);
  out.push("");
  out.push(
    summary ||
      `${name} is an x402-paid HTTP service. Replace this paragraph with one that says what it does and what an agent gets back.`,
  );
  out.push("");
  out.push(`- **Base URL:** \`${baseUrl}\``);
  out.push(`- **Manifest:** \`GET ${opts.manifestPath}\``);
  out.push(`- **OpenAPI:** \`GET ${opts.openapiPath}\``);
  if (contact) out.push(`- **Contact:** ${contact}`);
  out.push("");

  // ---- payment ------------------------------------------------------------
  out.push("## Payment");
  out.push("");
  out.push(
    "This service speaks **x402** (HTTP 402 Payment Required), protocol version 1, scheme `exact`. " +
      "Every paid route answers an unpaid request with a 402 whose `accepts` array carries **both rails — " +
      "USDC on Base (EVM) and USDC on Solana. Your client picks whichever it can sign.**",
  );
  out.push("");
  out.push(railsTable(rails));
  out.push("");
  if (paid[0]) {
    const first = paid[0];
    out.push("A 402 from this service looks like:");
    out.push("");
    out.push("```json");
    out.push(
      challengeExample(
        rails,
        first.price,
        `${baseUrl.replace(/\/$/, "")}${first.path.split(":")[0].replace(/\/$/, "")}`,
        String(first.op.summary ?? `${first.method} ${first.path}`),
      ),
    );
    out.push("```");
    out.push("");
  }
  out.push(
    "- **Asset:** USDC (6 decimals) on both rails. `maxAmountRequired` is in base units — `\"1000\"` is $0.001.",
  );
  out.push(
    "- **How to pay:** any x402 client. `x402-fetch` + `viem` on the EVM rail; on Solana build the SPL " +
      "`transferChecked` (the network fee is sponsored by `extra.feePayer`, so you need no SOL), sign it, and " +
      "base64 the envelope into `X-PAYMENT`.",
  );
  out.push(
    "- **Receipt:** paid responses carry `X-PAYMENT-RESPONSE`, a base64 JSON settlement receipt naming the rail, " +
      "network, transaction and payer.",
  );
  out.push("");
  out.push("Payment is per request. There is no account, no API key and no minimum.");
  out.push("");

  // ---- endpoints ----------------------------------------------------------
  for (const { method, path, price, op, pathItem } of paid) {
    out.push(`## \`${method} ${path}\` — ${price}`);
    out.push("");
    const desc = String(op.description ?? op.summary ?? "").trim();
    out.push(desc || `Returns the ${op.operationId ?? "resource"} in the 200 body.`);
    out.push("");
    const table = paramTable(openapi, op, pathItem);
    if (table) {
      out.push(table);
    }
    const ok = op.responses?.["200"] ?? op.responses?.["201"] ?? op.responses?.default;
    const example = ok ? responseExample(openapi, ok) : null;
    if (example) {
      out.push("**Response 200**");
      out.push("");
      out.push("```json");
      out.push(example);
      out.push("```");
      out.push("");
    } else {
      warnings.push(
        `${method} ${path}: no 200 example or schema in the OpenAPI document — the generated section has no response example (rule SM009).`,
      );
    }
  }

  // ---- free routes --------------------------------------------------------
  if (free.length) {
    out.push("## Free routes");
    out.push("");
    out.push("| route | returns |");
    out.push("|---|---|");
    for (const f of free) {
      const what = String(f.op.summary ?? f.op.description ?? "—")
        .replace(/\|/g, "\\|")
        .replace(/\n+/g, " ")
        .trim();
      out.push(`| \`${f.method} ${f.path}\` | ${what} |`);
    }
    out.push("");
  }

  // ---- errors -------------------------------------------------------------
  const codes = new Map<string, string>();
  for (const { op } of ops) {
    for (const [code, raw] of Object.entries(op.responses ?? {})) {
      if (!/^[45]\d\d$/.test(code)) continue;
      const response = deref(openapi, raw) as Json;
      if (!codes.has(code)) {
        codes.set(code, String(response?.description ?? "—").replace(/\|/g, "\\|").replace(/\n+/g, " "));
      }
    }
  }
  if (!codes.has("402") && paid.length) {
    codes.set("402", "Payment required or rejected; the body is the dual-rail challenge.");
  }
  out.push("## Errors");
  out.push("");
  out.push("| status | meaning |");
  out.push("|---|---|");
  for (const code of [...codes.keys()].sort()) out.push(`| ${code} | ${codes.get(code)} |`);
  out.push("");
  out.push(
    "A facilitator outage is reported as a 5xx, not a 402, so a retry loop cannot mistake an outage for a price.",
  );
  out.push("");

  return {
    skillMd: out.join("\n"),
    service: { name, baseUrl, endpoints: ops.length, paid: paid.length },
    warnings,
  };
}
