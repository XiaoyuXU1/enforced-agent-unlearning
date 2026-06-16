import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/hash.js";
import { resolveInsideRoot, unlearningPaths, readJson, writeJson } from "../src/storage.js";

describe("storage helpers", () => {
  it("rejects paths that escape the project root", () => {
    expect(() => resolveInsideRoot("C:/repo", "../outside.txt")).toThrow(
      /Path escapes project root/,
    );
  });

  it("writes stable sorted JSON under the plans path and reads it back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-"));
    try {
      const paths = unlearningPaths(root);
      const destination = await writeJson(paths.plans, "example.json", { b: 2, a: 1 });
      const content = await readFile(destination, "utf8");

      expect(destination).toBe(path.join(paths.plans, "example.json"));
      expect(content).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
      expect(await readJson(destination)).toEqual({ a: 1, b: 2 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal in JSON filenames", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-"));
    try {
      const paths = unlearningPaths(root);

      await expect(writeJson(paths.plans, "../escape.json", { a: 1 })).rejects.toThrow(
        /Invalid JSON filename/,
      );
      await expect(readJson(`${paths.plans}/../escape.json`)).rejects.toThrow(
        /Invalid JSON filename/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes atomically without leaving temp files behind", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-unlearning-"));
    try {
      const paths = unlearningPaths(root);
      const destination = await writeJson(paths.plans, "atomic.json", { b: 2, a: 1 });
      const entries = await readdir(paths.plans);

      expect(destination).toBe(path.join(paths.plans, "atomic.json"));
      expect(await readFile(destination, "utf8")).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
      expect(await readJson(destination)).toEqual({ a: 1, b: 2 });
      expect(entries).toEqual(["atomic.json"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("produces deterministic hashes", () => {
    expect(sha256("hello")).toBe(sha256(Buffer.from("hello")));
    expect(sha256("hello")).not.toBe(sha256("world"));
  });
});
