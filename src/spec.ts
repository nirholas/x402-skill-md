/**
 * spec.ts — the SKILL-MD format, as data.
 *
 * `skill.md` is the agent-facing contract file the x402 Suite ships at the root
 * of every service (the agentres.dev pattern). This module is the machine
 * -readable half of `docs/spec.md`: version, section grammar, and the rule
 * catalogue the validator enforces. Everything else in this package is built
 * from these constants, so the spec and the tooling cannot drift apart.
 */

/** The format version this library reads and writes. */
export const SKILL_MD_VERSION = "1.0";

/** Suite default receive addresses — public, safe to embed. */
export const DEFAULT_EVM_PAY_TO = "0x40252CFDF8B20Ed757D61ff157719F33Ec332402";
export const DEFAULT_SOLANA_PAY_TO = "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW";

/** USDC on every network the suite prices in. */
export const USDC = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "solana-devnet": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

export type RailId = "evm" | "solana";

/**
 * One payment rail. **A conformant skill.md documents at least one EVM rail and
 * at least one Solana rail** — dual-rail is a requirement of the format, not a
 * nicety, because an agent's wallet lives on exactly one chain and the whole
 * point of the file is that the agent can tell, before spending anything,
 * whether it can pay at all.
 */
export interface Rail {
  rail: RailId;
  network: string;
  asset: string;
  assetAddress: string;
  payTo: string;
  facilitator: string;
  /** Solana only: the sponsor account that pays the network fee. */
  feePayer?: string;
}

export const DEFAULT_RAILS: Rail[] = [
  {
    rail: "evm",
    network: "base-sepolia",
    asset: "USDC",
    assetAddress: USDC["base-sepolia"],
    payTo: DEFAULT_EVM_PAY_TO,
    facilitator: "https://x402.org/facilitator",
  },
  {
    rail: "solana",
    network: "solana",
    asset: "USDC",
    assetAddress: USDC.solana,
    payTo: DEFAULT_SOLANA_PAY_TO,
    facilitator: "https://facilitator.payai.network",
    feePayer: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4",
  },
];

/** Level-2 headings the format defines. */
export const SECTION = {
  payment: "Payment",
  freeRoutes: "Free routes",
  errors: "Errors",
  dataSource: "Data source",
} as const;

/**
 * Endpoint heading grammar:
 *
 *   ## `GET /check/:domain` — $0.001
 *   ## `POST /bounties` — $0.01
 *   ## `GET /skills.json` — free
 *
 * Backticks around `METHOD /path`, an em dash or hyphen, then a price:
 * `$` + a decimal, or the literal `free`.
 */
export const ENDPOINT_HEADING =
  /^##\s+`([A-Z]+)\s+(\/\S*)`\s*[—–-]\s*(free|\$\d+(?:\.\d+)?)\s*$/;

/** A price literal anywhere in prose. */
export const PRICE_LITERAL = /^(free|\$\d+(?:\.\d+)?)$/;

export type Severity = "error" | "warning" | "info";

export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  /** What a conformant document does instead. Surfaced verbatim as the fix. */
  fix: string;
}

/**
 * The rule catalogue. Ids are stable across versions: a rule may be retired but
 * its id is never reused, so a report from an old validator still reads
 * correctly.
 *
 * `error` — the file is not conformant; an agent may fail to use the service.
 * `warning` — conformant but lossy; an agent will have to guess something.
 * `info` — a suggestion.
 */
export const RULES: Record<string, Rule> = {
  SM001: {
    id: "SM001",
    severity: "error",
    title: "Missing H1 title",
    fix: "Start the file with a single `# <service-name>` heading naming the service.",
  },
  SM002: {
    id: "SM002",
    severity: "error",
    title: "Missing summary paragraph",
    fix: "Put one prose paragraph directly under the H1 saying what the service does and what an agent gets from it.",
  },
  SM003: {
    id: "SM003",
    severity: "error",
    title: "Missing base URL",
    fix: "Document the base URL, e.g. `- **Base URL:** https://your-host` (a localhost placeholder is fine for a self-hosted service).",
  },
  SM004: {
    id: "SM004",
    severity: "error",
    title: "Missing `## Payment` section",
    fix: "Add a `## Payment` section describing the x402 flow, the accepted rails, and how to pay.",
  },
  SM005: {
    id: "SM005",
    severity: "error",
    title: "No EVM payment rail documented",
    fix: "Name an EVM network (`base` or `base-sepolia`) and its `payTo` address in the Payment section.",
  },
  SM006: {
    id: "SM006",
    severity: "error",
    title: "No Solana payment rail documented",
    fix: "Name a Solana network (`solana` or `solana-devnet`) and its `payTo` address in the Payment section. Every conformant skill.md is dual-rail: an agent's wallet lives on one chain, and it must be able to tell from this file alone whether it can pay.",
  },
  SM007: {
    id: "SM007",
    severity: "error",
    title: "No endpoints documented",
    fix: "Document at least one endpoint as `## `METHOD /path` — $price` (or `— free`).",
  },
  SM008: {
    id: "SM008",
    severity: "error",
    title: "Endpoint heading does not match the grammar",
    fix: "Use ``## `METHOD /path` — $0.001`` : backticked `METHOD /path`, a dash, then `$amount` or `free`.",
  },
  SM009: {
    id: "SM009",
    severity: "warning",
    title: "Endpoint has no response example",
    fix: "Add a fenced ```json block showing a real 200 body, so an agent can plan against the shape before paying.",
  },
  SM010: {
    id: "SM010",
    severity: "warning",
    title: "Endpoint has no description",
    fix: "Add a sentence under the endpoint heading saying what the 200 body contains.",
  },
  SM011: {
    id: "SM011",
    severity: "warning",
    title: "Endpoint takes parameters but does not document them",
    fix: "Add a parameter table (name, in, type, required, notes). A `:param` in the path or a `?query=` in an example implies parameters.",
  },
  SM012: {
    id: "SM012",
    severity: "error",
    title: "Missing `## Errors` section",
    fix: "Add an `## Errors` section listing the status codes and error codes an agent can receive.",
  },
  SM013: {
    id: "SM013",
    severity: "warning",
    title: "Errors section does not mention 402",
    fix: "List the 402 response in the errors table — it is the one every paying client will hit first.",
  },
  SM014: {
    id: "SM014",
    severity: "warning",
    title: "No link to the x402 manifest",
    fix: "Reference `/.well-known/x402` so an agent can fetch the machine-readable manifest.",
  },
  SM015: {
    id: "SM015",
    severity: "warning",
    title: "No contact address",
    fix: "Add a contact email or URL so an operator can be reached about the service.",
  },
  SM016: {
    id: "SM016",
    severity: "warning",
    title: "No `x402Version` / protocol version stated",
    fix: "State the x402 protocol version and scheme, e.g. “x402 v1, scheme `exact`”.",
  },
  SM017: {
    id: "SM017",
    severity: "warning",
    title: "Price is not a well-formed literal",
    fix: "Write prices as `$0.001` (USD, dot decimal) or the literal `free`. Avoid ranges and “from”.",
  },
  SM018: {
    id: "SM018",
    severity: "warning",
    title: "No 402 challenge example",
    fix: "Include a fenced JSON block showing a real 402 body with its `accepts` array, so a client can be written against it without guessing.",
  },
  SM019: {
    id: "SM019",
    severity: "info",
    title: "No OpenAPI reference",
    fix: "Link `/openapi.json` for clients that prefer generated bindings.",
  },
  SM020: {
    id: "SM020",
    severity: "error",
    title: "Placeholder text left in the document",
    fix: "Replace TODO / FIXME / TBD / `<placeholder>` markers with real content before publishing.",
  },
  SM021: {
    id: "SM021",
    severity: "info",
    title: "No free routes documented",
    fix: "List the free discovery routes (`/`, `/health`, `/skill.md`, `/.well-known/x402`) so an agent can orient itself without paying.",
  },
  SM022: {
    id: "SM022",
    severity: "warning",
    title: "Frontmatter is present but malformed",
    fix: "Frontmatter is optional. If present it must be a `---` fenced block of `key: value` lines at the very top, including `skillMd: \"1.0\"`.",
  },
  SM023: {
    id: "SM023",
    severity: "info",
    title: "Data provenance not documented",
    fix: "If responses can come from fixtures, a cache, or a live upstream, add a `## Data source` section and a `source` field so an agent knows what it bought.",
  },
};

/** Weight of each severity when scoring a document out of 100. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 12,
  warning: 4,
  info: 1,
};
