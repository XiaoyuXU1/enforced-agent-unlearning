import { readFile } from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import { z } from "zod";

import { sha256 } from "./hash.js";
import { candidateSchema } from "./schema.js";

const supportedExtensions = ["md", "yaml", "yml", "json", "txt"];
const supportedExtensionSet = new Set(supportedExtensions);

const globPatterns = [
  "AGENTS.md",
  "CLAUDE.md",
  "SKILL.md",
  ...[".agents", ".claude", ".codex"].flatMap((directory) =>
    supportedExtensions.map((extension) => `**/${directory}/**/*.${extension}`),
  ),
];

const ignoredPatterns = ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.unlearning/**"];

export type Candidate = z.infer<typeof candidateSchema>;

function toRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeExplicitPattern(pattern: string): string {
  return pattern.replaceAll("\\", "/");
}

function validateTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed.length === 0) {
    throw new Error("Target must not be empty");
  }
  return trimmed;
}

function validateExplicitPattern(pattern: string): void {
  const normalized = normalizeExplicitPattern(pattern);
  if (path.isAbsolute(pattern) || normalized.split("/").includes("..")) {
    throw new Error("Explicit path escapes project root");
  }
}

export async function scanProject(
  projectRoot: string,
  target: string,
  explicitPaths: string[],
): Promise<Candidate[]> {
  const root = path.resolve(projectRoot);
  const normalizedTarget = validateTarget(target);
  const patterns = [...globPatterns, ...explicitPaths];

  for (const pattern of explicitPaths) {
    validateExplicitPattern(pattern);
  }

  const matches = await fg(patterns, {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: ignoredPatterns,
    unique: true,
    followSymbolicLinks: false,
    absolute: false,
  });

  const candidates: Candidate[] = [];

  for (const filePath of matches.sort(comparePaths)) {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    if (!supportedExtensionSet.has(extension)) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(path.resolve(root, filePath), "utf8");
    } catch {
      continue;
    }

    const fileHash = sha256(content);

    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (!line.includes(normalizedTarget)) {
        continue;
      }

      candidates.push(
        candidateSchema.parse({
          fileHash,
          line: index + 1,
          path: toRelativePath(root, path.resolve(root, filePath)),
          text: line,
        }),
      );
    }
  }

  return candidates;
}
