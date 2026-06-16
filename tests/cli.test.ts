import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createPolicy } from "../src/policy.js";
import { unlearningPaths, writeJson } from "../src/storage.js";
import { createAndStorePlan } from "../src/workflow.js";
import { buildProgram, runCli } from "../src/cli.js";

async function createProjectRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Always use Redux.\nKeep changes scoped.\n",
    "utf8",
  );
  return root;
}

async function canCreateSymlink(): Promise<boolean> {
  const root = await mkdtemp(path.join(tmpdir(), "cli-symlink-"));
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

function createIo(input = "") {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      cwd: "",
      stdin: Readable.from([Buffer.from(input, "utf8")]),
      stdout: (chunk: string) => {
        stdout += chunk;
      },
      stderr: (chunk: string) => {
        stderr += chunk;
      },
    },
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

const symlinkIt = (await canCreateSymlink()) ? it : it.skip;

describe("cli", () => {
  it("starts with a node shebang in source", async () => {
    const cliSource = await readFile(
      path.resolve(import.meta.dirname, "../src/cli.ts"),
      "utf8",
    );

    expect(cliSource.split(/\r?\n/, 1)[0]).toBe("#!/usr/bin/env node");
  });

  it("registers the required commands in order without command-specific options", () => {
    const program = buildProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual([
      "plan",
      "apply",
      "verify",
      "rollback",
      "inspect",
      "enforce",
    ]);
    expect(program.commands.map((command) => command.options)).toEqual([
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
  });

  it("plans against the current working directory and prints the stored plan JSON", async () => {
    const root = await createProjectRoot("cli-plan-");
    const capture = createIo();
    capture.io.cwd = root;

    const exitCode = await runCli(["node", "unlearn", "plan", "Always use Redux."], capture.io);
    const output = JSON.parse(capture.getStdout());
    const planFiles = await readdir(unlearningPaths(root).plans);

    expect(exitCode).toBe(0);
    expect(output.projectRoot).toBe(root);
    expect(output.manifest.target).toBe("Always use Redux.");
    expect(output.manifest.retain).toEqual([]);
    expect(planFiles).toEqual([`${output.id}.json`]);
  });

  it("passes retain boundaries through the plan command", async () => {
    const root = await createProjectRoot("cli-plan-retain-");
    const capture = createIo();
    capture.io.cwd = root;
    const received: unknown[] = [];
    const program = buildProgram(capture.io, {
      createAndStorePlan: async (projectRoot, manifest) => {
        received.push(projectRoot, manifest);
        return {
          id: "plan-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          projectRoot,
          manifest: {
            target: "Always use Redux",
            retain: [
              "Use Redux when explicitly requested",
              "Explain Redux when asked",
            ],
            scope: { include: [] },
            enforcement: { mode: "warn" },
            success: {
              forgetThreshold: 0.9,
              leakageThreshold: 0.8,
              retainThreshold: 0.9,
            },
          },
          candidates: [],
          probes: [],
        };
      },
      enforceProjectInput: async () => {
        throw new Error("not used");
      },
      rollbackReceipt: async () => {
        throw new Error("not used");
      },
    });

    program.exitOverride();
    await program.parseAsync([
      "node",
      "unlearn",
      "plan",
      "Always use Redux",
      "Use Redux when explicitly requested",
      "Explain Redux when asked",
    ]);

    expect(received).toEqual([
      root,
      {
        target: "Always use Redux",
        retain: [
          "Use Redux when explicitly requested",
          "Explain Redux when asked",
        ],
      },
    ]);
  });

  it("filters stdin with active policies, warns on stderr, and exits 2 when blocking", async () => {
    const root = await createProjectRoot("cli-enforce-");
    const policy = createPolicy(
      {
        target: "Always use Redux.",
        retain: ["Keep changes scoped."],
        enforcement: { mode: "block" },
      },
      "receipt-1",
      "2026-01-01T00:00:00.000Z",
      "policy-1",
    );
    await writeJson(unlearningPaths(root).policies, `${policy.id}.json`, policy);

    const capture = createIo("Always use Redux.\nKeep changes scoped.\n");
    capture.io.cwd = root;

    const exitCode = await runCli(["node", "unlearn", "enforce"], capture.io);
    const auditFiles = await readdir(unlearningPaths(root).audit);

    expect(exitCode).toBe(2);
    expect(capture.getStdout()).toBe("Keep changes scoped.\n");
    expect(capture.getStderr()).toContain(
      "Filtered content matching policy policy-1 from stdin.",
    );
    expect(auditFiles).toHaveLength(1);
  });

  it("reports apply as inconclusive because a provider adapter is required", async () => {
    const root = await createProjectRoot("cli-apply-");
    const capture = createIo();
    capture.io.cwd = root;

    const exitCode = await runCli(["node", "unlearn", "apply", "plan-123"], capture.io);
    const output = JSON.parse(capture.getStdout());
    const receiptsDirectory = unlearningPaths(root).receipts;

    expect(exitCode).toBe(2);
    expect(output).toMatchObject({
      action: "apply",
      planId: "plan-123",
      verdict: "inconclusive",
    });
    expect(output.message).toMatch(/provider adapter is required/i);
    await expect(readFile(path.join(receiptsDirectory, "plan-123.json"), "utf8")).rejects.toThrow();
  });

  it("reports verify as inconclusive because a provider adapter is required", async () => {
    const root = await createProjectRoot("cli-verify-");
    const capture = createIo();
    capture.io.cwd = root;

    const exitCode = await runCli(["node", "unlearn", "verify", "receipt-123"], capture.io);
    const output = JSON.parse(capture.getStdout());

    expect(exitCode).toBe(2);
    expect(output).toMatchObject({
      action: "verify",
      receiptId: "receipt-123",
      verdict: "inconclusive",
    });
    expect(output.message).toMatch(/provider adapter is required/i);
  });

  it("inspects stored control-plane json files and returns sorted file names", async () => {
    const root = await createProjectRoot("cli-inspect-");
    const paths = unlearningPaths(root);
    const plan = await createAndStorePlan(root, { target: "Always use Redux." });
    await writeJson(paths.policies, "b.json", { id: "b" });
    await writeJson(paths.policies, "a.json", { id: "a" });
    await writeFile(path.join(paths.policies, "ignore.txt"), "nope", "utf8");

    const capture = createIo();
    capture.io.cwd = root;

    const exitCode = await runCli(["node", "unlearn", "inspect"], capture.io);
    const output = JSON.parse(capture.getStdout());

    expect(exitCode).toBe(0);
    expect(output).toEqual({
      audit: [],
      plans: [`${plan.id}.json`],
      policies: ["a.json", "b.json"],
      receipts: [],
    });
  });

  symlinkIt("rejects symlinked inspected control directories without listing outside files", async () => {
    const root = await createProjectRoot("cli-inspect-symlink-");
    const outside = await mkdtemp(path.join(tmpdir(), "cli-inspect-outside-"));
    const paths = unlearningPaths(root);
    await mkdir(paths.base, { recursive: true });
    await writeFile(path.join(outside, "secret.json"), "{\"id\":\"secret\"}\n", "utf8");
    await symlink(outside, paths.policies, "dir");

    const capture = createIo();
    capture.io.cwd = root;

    await expect(runCli(["node", "unlearn", "inspect"], capture.io)).rejects.toThrow(
      "Symbolic links are not allowed",
    );
    expect(capture.getStdout()).not.toContain("secret.json");
    expect(capture.getStderr()).not.toContain("secret.json");
  });
});
