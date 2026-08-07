/**
 * x402-skill-md — the skill.md toolkit.
 *
 * `skill.md` is the agent-facing contract file an x402 service ships at its
 * root: what it does, what each endpoint costs, what comes back, and how to
 * pay — in Markdown a model can read and a parser can check. This package
 * defines that format (see `docs/spec.md`), generates one from an OpenAPI
 * document, and validates one with actionable fixes.
 *
 * ```ts
 * import { openapiToSkillMd, validateSkillMd } from "x402-skill-md";
 *
 * const { skillMd } = openapiToSkillMd(JSON.parse(await readFile("openapi.json", "utf8")));
 * const report = validateSkillMd(skillMd);
 * report.valid; // true
 * ```
 */
export {
  SKILL_MD_VERSION,
  DEFAULT_RAILS,
  DEFAULT_EVM_PAY_TO,
  DEFAULT_SOLANA_PAY_TO,
  USDC,
  RULES,
  SEVERITY_WEIGHT,
  ENDPOINT_HEADING,
  PRICE_LITERAL,
  SECTION,
  type Rail,
  type RailId,
  type Rule,
  type Severity,
} from "./spec.js";

export {
  parseSkillMd,
  findSection,
  type ParsedSkill,
  type ParsedEndpoint,
  type ParsedSection,
} from "./parse.js";

export {
  validateSkillMd,
  validateParsed,
  formatReport,
  type ValidationReport,
  type Finding,
} from "./validate.js";

export {
  openapiToSkillMd,
  type GenerateOptions,
  type GenerateResult,
} from "./generate.js";
