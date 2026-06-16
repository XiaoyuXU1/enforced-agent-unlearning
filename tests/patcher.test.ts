import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256 } from "../src/hash.js";
import { applyCandidates, reverseChanges } from "../src/patcher.js";

async function canCreateSymlink(): Promise<boolean> {
  const root = await mkdtemp(path.join(tmpdir(), "unlearn-symlink-"));
  const target = path.join(root, "target.txt");
  const link = path.join(root, "link.txt");

  try {
    await writeFile(target, "target", "utf8");
    await symlink(target, link);
    await access(link);
    return true;
  } catch {
    return false;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const symlinkIt = (await canCreateSymlink()) ? it : it.skip;

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

async function importPatcherWithWriteFileMock(
  factory: (
    actual: typeof import("node:fs/promises"),
  ) => typeof import("node:fs/promises")["writeFile"],
) {
  vi.resetModules();
  vi.doMock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    return {
      ...actual,
      writeFile: factory(actual),
    };
  });
  return import("../src/patcher.js");
}

describe("applyCandidates", () => {
  it("restores attempted targets and removes snapshots when a later target write fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const first = path.join(root, "first.md");
    const second = path.join(root, "second.md");
    const firstOriginal = "Keep first.\nAlways use Redux.\n";
    const secondOriginal = "Keep second.\nAlways use Redux.\n";
    await writeFile(first, firstOriginal, "utf8");
    await writeFile(second, secondOriginal, "utf8");

    const { applyCandidates: applyCandidatesWithMock } = await importPatcherWithWriteFileMock(
      (actual) => {
        let failed = false;
        return async (file, data, options) => {
          const targetPath =
            typeof file === "string" ? path.resolve(file) : file.toString();
          if (
            !failed &&
            targetPath === path.resolve(second) &&
            data === "Keep second.\n" &&
            options === "utf8"
          ) {
            failed = true;
            throw new Error("simulated target write failure");
          }
          return actual.writeFile(file, data, options);
        };
      },
    );

    await expect(
      applyCandidatesWithMock(root, "receipt-1", [
        {
          path: "first.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(firstOriginal),
        },
        {
          path: "second.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(secondOriginal),
        },
      ]),
    ).rejects.toThrow("simulated target write failure");

    expect(await readFile(first, "utf8")).toBe(firstOriginal);
    expect(await readFile(second, "utf8")).toBe(secondOriginal);
    await expect(
      readdir(path.join(root, ".unlearning", "snapshots", "receipt-1")),
    ).rejects.toThrow();
  });

  it("removes only the approved line and snapshots the original file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\nKeep that.\n";
    await writeFile(target, original, "utf8");

    const changes = await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 2,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    expect(changes).toEqual([
      {
        path: "AGENTS.md",
        line: 2,
        removedText: "Always use Redux.",
        beforeHash: sha256(original),
        afterHash: sha256("Keep this.\nKeep that.\n"),
      },
    ]);
    expect(await readFile(target, "utf8")).toBe("Keep this.\nKeep that.\n");
    expect(
      await readFile(
        path.join(
          root,
          ".unlearning",
          "snapshots",
          "receipt-1",
          "AGENTS.md",
        ),
        "utf8",
      ),
    ).toBe(original);
  });

  it("rejects stale plans", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\nKeep that.\n";
    await writeFile(target, original, "utf8");

    await writeFile(target, "Keep this.\nKeep that.\n", "utf8");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: "AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Stale plan");
  });

  it("canonicalizes aliases for the same file into one group", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\nKeep that.\nAlways use Redux.\n";
    await writeFile(target, original, "utf8");

    const changes = await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 2,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
      {
        path: "./AGENTS.md",
        line: 4,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    expect(changes.map((change) => change.path)).toEqual([
      "AGENTS.md",
      "AGENTS.md",
    ]);
    expect(
      await readFile(
        path.join(
          root,
          ".unlearning",
          "snapshots",
          "receipt-1",
          "AGENTS.md",
        ),
        "utf8",
      ),
    ).toBe(original);
    expect(await readFile(target, "utf8")).toBe("Keep this.\nKeep that.\n");
  });

  it("rejects duplicate candidates for the same canonical file and line", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\nKeep that.\n";
    await writeFile(target, original, "utf8");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: "AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
        {
          path: "./AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Duplicate candidate");

    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("rejects explicit parent segments in candidate paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\n";
    await writeFile(target, original, "utf8");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: "sub/../AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Invalid candidate path");

    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("rejects existing snapshot destinations before writing targets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\n";
    await writeFile(target, original, "utf8");

    const snapshot = path.join(
      root,
      ".unlearning",
      "snapshots",
      "receipt-1",
      "AGENTS.md",
    );
    await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, original, "utf8");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: "AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Snapshot already exists");

    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("removes multiple approved lines from the same file in one transaction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\nKeep that.\nAlways use Redux.\n";
    await writeFile(target, original, "utf8");

    const changes = await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 2,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
      {
        path: "AGENTS.md",
        line: 4,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    expect(changes).toEqual([
      {
        path: "AGENTS.md",
        line: 4,
        removedText: "Always use Redux.",
        beforeHash: sha256(original),
        afterHash: sha256("Keep this.\nAlways use Redux.\nKeep that.\n"),
      },
      {
        path: "AGENTS.md",
        line: 2,
        removedText: "Always use Redux.",
        beforeHash: sha256(original),
        afterHash: sha256("Keep this.\nKeep that.\n"),
      },
    ]);
    expect(await readFile(target, "utf8")).toBe("Keep this.\nKeep that.\n");
    expect(
      await readFile(
        path.join(
          root,
          ".unlearning",
          "snapshots",
          "receipt-1",
          "AGENTS.md",
        ),
        "utf8",
      ),
    ).toBe(original);
  });

  it("preserves CRLF when the source file uses CRLF", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\r\nAlways use Redux.\r\nKeep that.\r\n";
    await writeFile(target, original, "utf8");

    await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 2,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    expect(await readFile(target, "utf8")).toBe("Keep this.\r\nKeep that.\r\n");
  });

  symlinkIt("rejects symlink targets before reading or writing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const realDir = path.join(root, "real");
    const realTarget = path.join(realDir, "AGENTS.md");
    const linkDir = path.join(root, "linked");
    const original = "Keep this.\nAlways use Redux.\nKeep that.\n";

    await writeFile(realTarget, original, "utf8");
    await symlink(realDir, linkDir, "dir");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: path.join("linked", "AGENTS.md"),
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Symbolic links are not allowed");
    expect(await readFile(realTarget, "utf8")).toBe(original);
  });

  symlinkIt("rejects symlinks in the snapshot destination path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const snapshotLinkTarget = path.join(root, "snapshot-store");
    const snapshotFile = path.join(snapshotLinkTarget, "snapshots", "receipt-1", "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\n";

    await writeFile(target, original, "utf8");
    await mkdir(snapshotLinkTarget, { recursive: true });
    await symlink(snapshotLinkTarget, path.join(root, ".unlearning"), "dir");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: "AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Symbolic links are not allowed");
    expect(await readFile(target, "utf8")).toBe(original);
    await expect(stat(snapshotFile)).rejects.toThrow();
  });

  it("rejects unsafe receipt ids before writing snapshots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Keep this.\nAlways use Redux.\n";
    await writeFile(target, original, "utf8");

    await expect(
      applyCandidates(root, "../receipt-1", [
        {
          path: "AGENTS.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(original),
        },
      ]),
    ).rejects.toThrow("Invalid receipt id");

    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("does not modify an earlier file when a later file is stale", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-patcher-"));
    const first = path.join(root, "first.md");
    const second = path.join(root, "second.md");
    const firstOriginal = "Keep this.\nAlways use Redux.\n";
    const secondOriginal = "Keep that.\nAlways use Redux.\n";
    await writeFile(first, firstOriginal, "utf8");
    await writeFile(second, secondOriginal, "utf8");

    await writeFile(second, "Keep that.\nUpdated.\n", "utf8");

    await expect(
      applyCandidates(root, "receipt-1", [
        {
          path: "first.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(firstOriginal),
        },
        {
          path: "second.md",
          line: 2,
          text: "Always use Redux.",
          fileHash: sha256(secondOriginal),
        },
      ]),
    ).rejects.toThrow("Stale plan");

    expect(await readFile(first, "utf8")).toBe(firstOriginal);
    expect(await readFile(second, "utf8")).toBe("Keep that.\nUpdated.\n");
  });
});

describe("reverseChanges", () => {
  it("restores the original content and preserves an unrelated appended suffix", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-reverse-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(target, original, "utf8");

    const changes = await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 1,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    await writeFile(
      target,
      "Keep changes scoped.\nAppended later.\n",
      "utf8",
    );

    await reverseChanges(root, "receipt-1", changes);

    expect(await readFile(target, "utf8")).toBe(
      "Always use Redux.\nKeep changes scoped.\nAppended later.\n",
    );
  });

  it("restores removed content before unrelated appended content when the applied file was empty", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-reverse-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Always use Redux.\r\n";
    await writeFile(target, original, "utf8");

    const changes = await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 1,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    await writeFile(target, "Appended later.\r\n", "utf8");

    await reverseChanges(root, "receipt-1", changes);

    expect(await readFile(target, "utf8")).toBe(
      "Always use Redux.\r\nAppended later.\r\n",
    );
  });

  it("is idempotent when the file is already restored with an appended suffix", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-reverse-"));
    const target = path.join(root, "AGENTS.md");
    const original = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(target, original, "utf8");

    const changes = await applyCandidates(root, "receipt-1", [
      {
        path: "AGENTS.md",
        line: 1,
        text: "Always use Redux.",
        fileHash: sha256(original),
      },
    ]);

    await writeFile(
      target,
      "Always use Redux.\nKeep changes scoped.\nAppended later.\n",
      "utf8",
    );

    await reverseChanges(root, "receipt-1", changes);

    expect(await readFile(target, "utf8")).toBe(
      "Always use Redux.\nKeep changes scoped.\nAppended later.\n",
    );
  });
});
