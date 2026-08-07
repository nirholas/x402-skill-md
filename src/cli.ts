#!/usr/bin/env node
/**
 * cli.ts — `npx x402-skill-md`
 *
 *   x402-skill-md generate <openapi.json> [-o skill.md] [--base-url URL] [--contact EMAIL]
 *   x402-skill-md validate <skill.md> [--json] [--strict]
 *   x402-skill-md rules [--json]
 *
 * Exit codes: 0 conformant, 1 errors found (or warnings under --strict), 2 usage.
 * Reads stdin when the file argument is `-`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { openapiToSkillMd, type GenerateOptions } from "./generate.js";
import { formatReport, validateSkillMd } from "./validate.js";
import { DEFAULT_RAILS, RULES, SKILL_MD_VERSION } from "./spec.js";

const USAGE = `x402-skill-md ${SKILL_MD_VERSION} — generate and validate agent-discoverable skill.md files

USAGE
  x402-skill-md generate <openapi.json> [options]
  x402-skill-md validate <skill.md> [options]
  x402-skill-md rules [--json]

GENERATE
  -o, --out <file>       write to a file instead of stdout
      --base-url <url>   override servers[0].url
      --contact <email>  override info.contact.email
      --default-price <p>  price for paid operations with no declared amount (e.g. $0.001)
      --no-frontmatter   omit the YAML frontmatter block

VALIDATE
      --json             emit the full report as JSON
      --strict           exit non-zero on warnings too

Use "-" as the file to read from stdin.
Format specification: https://nirholas.github.io/x402-skill-md/spec
`;

function read(file: string): string {
  if (file === "-") return readFileSync(0, "utf8");
  try {
    return readFileSync(file, "utf8");
  } catch {
    console.error(`error: cannot read ${file}`);
    process.exit(2);
  }
}

function flag(argv: string[], ...names: string[]): boolean {
  return names.some((n) => argv.includes(n));
}

function value(argv: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const i = argv.indexOf(name);
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  }
  return undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || flag(argv, "-h", "--help")) {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }

  if (command === "rules") {
    if (flag(argv, "--json")) {
      console.log(JSON.stringify({ skillMdVersion: SKILL_MD_VERSION, rules: RULES }, null, 2));
      return;
    }
    console.log(`SKILL-MD ${SKILL_MD_VERSION} — ${Object.keys(RULES).length} rules\n`);
    for (const rule of Object.values(RULES)) {
      console.log(`${rule.id}  [${rule.severity}]  ${rule.title}`);
      console.log(`      ${rule.fix}\n`);
    }
    return;
  }

  const file = argv[1];
  if (!file || file.startsWith("-") && file !== "-") {
    console.error(`error: ${command} needs a file argument\n`);
    console.log(USAGE);
    process.exit(2);
  }

  if (command === "generate") {
    let openapi: unknown;
    try {
      openapi = JSON.parse(read(file));
    } catch (err) {
      console.error(`error: ${file} is not valid JSON — ${(err as Error).message}`);
      process.exit(2);
    }

    const options: GenerateOptions = {
      baseUrl: value(argv, "--base-url"),
      contact: value(argv, "--contact"),
      defaultPrice: value(argv, "--default-price"),
      frontmatter: !flag(argv, "--no-frontmatter"),
      rails: DEFAULT_RAILS,
    };

    let result;
    try {
      result = openapiToSkillMd(openapi as Record<string, unknown>, options);
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      process.exit(2);
    }

    const out = value(argv, "-o", "--out");
    if (out) {
      writeFileSync(out, result.skillMd);
      console.error(
        `wrote ${out} — ${result.service.name}, ${result.service.paid} paid of ${result.service.endpoints} endpoints`,
      );
    } else {
      process.stdout.write(result.skillMd);
    }

    for (const warning of result.warnings) console.error(`warning: ${warning}`);

    // A generated file should be conformant. If it is not, the input was thin.
    const report = validateSkillMd(result.skillMd);
    if (!report.valid) {
      console.error(
        `\nwarning: the generated file has ${report.summary.errors} error(s) — ` +
          `run \`x402-skill-md validate\` on it and fill in what the OpenAPI document did not carry.`,
      );
    }
    return;
  }

  if (command === "validate") {
    const report = validateSkillMd(read(file));
    if (flag(argv, "--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatReport(report));
    }
    const failed = !report.valid || (flag(argv, "--strict") && report.summary.warnings > 0);
    process.exit(failed ? 1 : 0);
  }

  console.error(`error: unknown command "${command}"\n`);
  console.log(USAGE);
  process.exit(2);
}

main();
