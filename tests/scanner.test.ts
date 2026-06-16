import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { scanProject } from "../src/scanner.js";

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/project");

function isSymlinkPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /EPERM|EACCES|privilege|symbolic link/i.test(error.message) ||
    // Windows often surfaces symlink failures as generic access errors.
    (error as { code?: string }).code === "EPERM" ||
    (error as { code?: string }).code === "EACCES"
  );
}

async function canCreateSymlink(): Promise<boolean> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-symlink-"));
  try {
    const source = path.join(root, "source");
    const link = path.join(root, "link");
    await mkdir(source, { recursive: true });
    await symlink(source, link, "dir");
    return true;
  } catch (error) {
    if (isSymlinkPermissionError(error)) {
      return false;
    }
    throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const symlinkTest = (await canCreateSymlink()) ? it : it.skip;

describe("scanProject", () => {
  it("returns the AGENTS.md instruction line for the exact target", async () => {
    const candidates = await scanProject(fixturesRoot, "Always use Redux for shared state.", []);

    expect(candidates).toEqual([
      {
        fileHash: expect.any(String),
        line: 3,
        path: "AGENTS.md",
        text: "Always use Redux for shared state.",
      },
    ]);
  });

  it("rejects a blank target", async () => {
    await expect(scanProject(fixturesRoot, "   ", [])).rejects.toThrow(
      /Target must not be empty/,
    );
  });

  it("expands explicit .codex/**/*.md patterns", async () => {
    const candidates = await scanProject(fixturesRoot, "The project prefers Redux.", [
      ".codex/**/*.md",
    ]);

    expect(candidates).toEqual([
      {
        fileHash: expect.any(String),
        line: 1,
        path: ".codex/memory.md",
        text: "The project prefers Redux.",
      },
    ]);
  });

  it("excludes unsupported source files matched by explicit globs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-project-"));

    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src/policy.ts"), "The project prefers Redux.", "utf8");
      await writeFile(path.join(root, "src/memory.md"), "The project prefers Redux.", "utf8");

      const candidates = await scanProject(root, "The project prefers Redux.", ["src/**/*"]);

      expect(candidates.map((candidate) => candidate.path)).toEqual(["src/memory.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects absolute explicit paths", async () => {
    await expect(
      scanProject(fixturesRoot, "The project prefers Redux.", [
        path.resolve(fixturesRoot, ".codex/memory.md"),
      ]),
    ).rejects.toThrow(/Explicit path escapes project root/);
  });

  it("rejects explicit paths with .. segments", async () => {
    await expect(
      scanProject(fixturesRoot, "The project prefers Redux.", ["../outside.md"]),
    ).rejects.toThrow(/Explicit path escapes project root/);
  });

  it("keeps default AGENTS.md scanning project-local", async () => {
    const candidates = await scanProject(fixturesRoot, "Always use Redux for shared state.", []);

    expect(candidates).toHaveLength(1);
    expect(candidates.map((candidate) => candidate.path)).toEqual(["AGENTS.md"]);
  });

  symlinkTest("does not follow symlinked supported paths outside the project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-project-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-outside-"));

    try {
      await writeFile(path.join(outside, "memory.md"), "The project prefers Redux.", "utf8");
      await symlink(outside, path.join(root, ".codex"), "dir");

      const candidates = await scanProject(root, "The project prefers Redux.", [
        ".codex/**/*.md",
      ]);

      expect(candidates).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
