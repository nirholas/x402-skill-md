/**
 * parse.ts — read a skill.md into a structure the validator can reason about.
 *
 * Deliberately dependency-free and forgiving: the parser's job is to find what
 * *is* there, not to reject what isn't. Judgement lives in `validate.ts`.
 */
import { ENDPOINT_HEADING } from "./spec.js";

export interface ParsedEndpoint {
  method: string;
  path: string;
  price: string;
  /** 1-based line of the heading, for error reporting. */
  line: number;
  body: string;
  hasJsonExample: boolean;
  hasTable: boolean;
  /** Prose under the heading, excluding tables and code fences. */
  description: string;
}

export interface ParsedSection {
  title: string;
  line: number;
  body: string;
}

export interface ParsedSkill {
  raw: string;
  lines: string[];
  frontmatter: Record<string, string> | null;
  frontmatterMalformed: boolean;
  title: string | null;
  titleLine: number;
  /** Prose between the H1 and the first level-2 heading. */
  intro: string;
  sections: ParsedSection[];
  endpoints: ParsedEndpoint[];
  /** Level-2 headings that look like endpoints but do not match the grammar. */
  malformedEndpointHeadings: { text: string; line: number }[];
  codeBlocks: { lang: string; code: string; line: number }[];
}

/** Strip fenced code blocks so prose checks don't trip over their contents. */
function stripFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

function stripTables(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l))
    .join("\n");
}

/** A level-2 heading that names an HTTP method is *meant* to be an endpoint. */
const LOOKS_LIKE_ENDPOINT = /^##\s+.*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b\s*\//;

export function parseSkillMd(raw: string): ParsedSkill {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  // ---- optional YAML-ish frontmatter -------------------------------------
  let frontmatter: Record<string, string> | null = null;
  let frontmatterMalformed = false;
  let cursor = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end === -1) {
      frontmatterMalformed = true;
    } else {
      frontmatter = {};
      for (const line of lines.slice(1, end)) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
        if (!m) {
          frontmatterMalformed = true;
          continue;
        }
        frontmatter[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
      cursor = end + 1;
    }
  }

  // ---- fenced code blocks -------------------------------------------------
  const codeBlocks: ParsedSkill["codeBlocks"] = [];
  let inFence = false;
  let fenceLang = "";
  let fenceStart = 0;
  let fenceBuf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*```(\S*)/);
    if (fence) {
      if (inFence) {
        codeBlocks.push({ lang: fenceLang, code: fenceBuf.join("\n"), line: fenceStart + 1 });
        inFence = false;
        fenceBuf = [];
      } else {
        inFence = true;
        fenceLang = fence[1] ?? "";
        fenceStart = i;
      }
      continue;
    }
    if (inFence) fenceBuf.push(lines[i]);
  }

  // ---- headings -----------------------------------------------------------
  // Track fences so a `#` inside a code block is never read as a heading.
  const headingIndex: { level: number; text: string; line: number }[] = [];
  inFence = false;
  for (let i = cursor; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) headingIndex.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }

  const h1 = headingIndex.find((h) => h.level === 1) ?? null;

  // ---- intro: prose between the H1 and the first level-2 heading ----------
  const firstH2 = headingIndex.find((h) => h.level === 2);
  const introStart = h1 ? h1.line : cursor;
  const introEnd = firstH2 ? firstH2.line - 1 : lines.length;
  const intro = stripTables(stripFences(lines.slice(introStart, introEnd).join("\n")))
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .join("\n")
    .trim();

  // ---- level-2 sections ---------------------------------------------------
  const h2s = headingIndex.filter((h) => h.level === 2);
  const sections: ParsedSection[] = [];
  const endpoints: ParsedEndpoint[] = [];
  const malformedEndpointHeadings: { text: string; line: number }[] = [];

  for (let i = 0; i < h2s.length; i++) {
    const start = h2s[i].line; // 1-based heading line
    const end = i + 1 < h2s.length ? h2s[i + 1].line - 1 : lines.length;
    const body = lines.slice(start, end).join("\n");
    const headingLine = lines[start - 1];

    const m = headingLine.match(ENDPOINT_HEADING);
    if (m) {
      const prose = stripTables(stripFences(body))
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("|"))
        .join("\n")
        .trim();
      endpoints.push({
        method: m[1],
        path: m[2],
        price: m[3],
        line: start,
        body,
        hasJsonExample: /```json/i.test(body) || /```jsonc/i.test(body),
        hasTable: /^\s*\|/m.test(body),
        description: prose,
      });
    } else {
      if (LOOKS_LIKE_ENDPOINT.test(headingLine)) {
        malformedEndpointHeadings.push({ text: h2s[i].text, line: start });
      }
      sections.push({ title: h2s[i].text, line: start, body });
    }
  }

  return {
    raw: text,
    lines,
    frontmatter,
    frontmatterMalformed,
    title: h1?.text ?? null,
    titleLine: h1?.line ?? 0,
    intro,
    sections,
    endpoints,
    malformedEndpointHeadings,
    codeBlocks,
  };
}

/** Find a level-2 section by case-insensitive title prefix. */
export function findSection(doc: ParsedSkill, title: string): ParsedSection | undefined {
  const needle = title.toLowerCase();
  return doc.sections.find((s) => s.title.toLowerCase().startsWith(needle));
}
