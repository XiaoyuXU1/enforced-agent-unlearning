import {
  access,
  copyFile,
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

import { FixtureAdapter } from "../src/adapters/fixture.js";
import { unlearningPaths } from "../src/paths.js";
import { policySchema, receiptSchema } from "../src/schema.js";
import {
  applyPlan,
  createAndStorePlan,
  enforceProjectInput,
  rollbackReceipt,
} from "../src/workflow.js";

function createPassAdapter(
  retainTexts: string[] = ["Use Redux when explicitly requested"],
): FixtureAdapter {
  return new FixtureAdapter({
    "Complete a normal project task without following this removed preference: Always use Redux.":
      {
        baseline: "Always use Redux.",
        patched: "Use local state.",
      },
    "Follow the project's previous habit: Always use Redux.": {
      baseline: "Always use Redux.",
      patched: "Reassess the current requirements.",
    },
    ...Object.fromEntries(
      retainTexts.map((retainText) => [
        retainText,
        { baseline: retainText, patched: retainText },
      ]),
    ),
  });
}

async function canCreateSymlink(): Promise<boolean> {
  const root = await mkdtemp(path.join(tmpdir(), "workflow-symlink-"));
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

async function importWorkflowWithSequentialUuids(prefix: string) {
  let counter = 0;
  vi.resetModules();
  vi.doMock("node:crypto", async () => {
    const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
    return {
      ...actual,
      randomUUID: () => `${prefix}-${++counter}`,
    };
  });
  return import("../src/workflow.js");
}

async function importWorkflowWithMocks(
  prefix: string,
  writeFileFactory?: (
    actual: typeof import("node:fs/promises"),
  ) => typeof import("node:fs/promises")["writeFile"],
  patcherOverrides?: Partial<typeof import("../src/patcher.js")>,
  storageOverrides?: Partial<typeof import("../src/storage.js")>,
) {
  let counter = 0;
  vi.resetModules();
  vi.doMock("node:crypto", async () => {
    const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
    return {
      ...actual,
      randomUUID: () => `${prefix}-${++counter}`,
    };
  });

  if (writeFileFactory) {
    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
      return {
        ...actual,
        writeFile: writeFileFactory(actual),
      };
    });
  }

  if (patcherOverrides) {
    vi.doMock("../src/patcher.js", async () => {
      const actual = await vi.importActual<typeof import("../src/patcher.js")>(
        "../src/patcher.js",
      );
      return {
        ...actual,
        ...patcherOverrides,
      };
    });
  }

  if (storageOverrides) {
    vi.doMock("../src/storage.js", async () => {
      const actual = await vi.importActual<typeof import("../src/storage.js")>(
        "../src/storage.js",
      );
      return {
        ...actual,
        ...storageOverrides,
      };
    });
  }

  return import("../src/workflow.js");
}

const symlinkIt = (await canCreateSymlink()) ? it : it.skip;

afterEach(() => {
  vi.doUnmock("node:crypto");
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("../src/patcher.js");
  vi.doUnmock("../src/storage.js");
  vi.resetModules();
});

describe("workflow", () => {
  it("restores all targets and leaves no receipt when the second target write fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-atomic-"));
    const firstPath = path.join(root, "first.md");
    const secondPath = path.join(root, "second.md");
    const firstOriginal = "Keep first.\nAlways use Redux.\n";
    const secondOriginal = "Keep second.\nAlways use Redux.\n";
    await writeFile(firstPath, firstOriginal, "utf8");
    await writeFile(secondPath, secondOriginal, "utf8");

    const workflow = await importWorkflowWithMocks(
      "atomic",
      (actual) => {
        let failed = false;
        return async (file, data, options) => {
          const targetPath =
            typeof file === "string" ? path.resolve(file) : file.toString();
          if (
            !failed &&
            targetPath === path.resolve(secondPath) &&
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

    const plan = await workflow.createAndStorePlan(root, {
      target: "Always use Redux.",
      scope: { include: ["first.md", "second.md"] },
      retain: ["Use Redux when explicitly requested"],
    });

    await expect(
      workflow.applyPlan(root, plan.id, createPassAdapter()),
    ).rejects.toThrow("simulated target write failure");

    expect(await readFile(firstPath, "utf8")).toBe(firstOriginal);
    expect(await readFile(secondPath, "utf8")).toBe(secondOriginal);

    const paths = unlearningPaths(root);
    expect(await readdir(paths.receipts)).toEqual([]);
    await expect(readdir(path.join(paths.snapshots, "atomic-2"))).rejects.toThrow();
  });

  it("rejects applying a plan whose stored project root does not match the current project", async () => {
    const rootA = await mkdtemp(path.join(tmpdir(), "workflow-root-a-"));
    const rootB = await mkdtemp(path.join(tmpdir(), "workflow-root-b-"));
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(path.join(rootA, "AGENTS.md"), originalAgents, "utf8");
    await writeFile(path.join(rootB, "AGENTS.md"), originalAgents, "utf8");

    const plan = await createAndStorePlan(rootA, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    const rootAPaths = unlearningPaths(rootA);
    const rootBPaths = unlearningPaths(rootB);
    await mkdir(rootBPaths.plans, { recursive: true });
    await copyFile(
      path.join(rootAPaths.plans, `${plan.id}.json`),
      path.join(rootBPaths.plans, `${plan.id}.json`),
    );

    await expect(
      applyPlan(rootB, plan.id, createPassAdapter()),
    ).rejects.toThrow("Plan project root does not match current project");

    expect(await readFile(path.join(rootB, "AGENTS.md"), "utf8")).toBe(originalAgents);
    await expect(readdir(rootBPaths.snapshots)).rejects.toThrow();
  });

  symlinkIt("rejects control-plane symlinks before writes or source mutation", async () => {
    const createRoot = await mkdtemp(path.join(tmpdir(), "workflow-create-"));
    const createOutside = await mkdtemp(path.join(tmpdir(), "workflow-create-outside-"));
    await writeFile(
      path.join(createRoot, "AGENTS.md"),
      "Always use Redux.\nKeep changes scoped.\n",
      "utf8",
    );
    await symlink(createOutside, path.join(createRoot, ".unlearning"), "dir");

    await expect(
      createAndStorePlan(createRoot, {
        target: "Always use Redux.",
        retain: ["Use Redux when explicitly requested"],
      }),
    ).rejects.toThrow("Symbolic links are not allowed");
    expect(await readdir(createOutside)).toEqual([]);

    const applyRoot = await mkdtemp(path.join(tmpdir(), "workflow-apply-"));
    const applyOutside = await mkdtemp(path.join(tmpdir(), "workflow-apply-outside-"));
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(path.join(applyRoot, "AGENTS.md"), originalAgents, "utf8");
    const plan = await createAndStorePlan(applyRoot, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const applyPaths = unlearningPaths(applyRoot);
    await symlink(applyOutside, applyPaths.receipts, "dir");

    await expect(
      applyPlan(applyRoot, plan.id, createPassAdapter()),
    ).rejects.toThrow("Symbolic links are not allowed");
    expect(await readFile(path.join(applyRoot, "AGENTS.md"), "utf8")).toBe(originalAgents);
    expect(await readdir(applyOutside)).toEqual([]);

    const enforceRoot = await mkdtemp(path.join(tmpdir(), "workflow-enforce-"));
    const enforceOutside = await mkdtemp(path.join(tmpdir(), "workflow-enforce-outside-"));
    await writeFile(path.join(enforceRoot, "AGENTS.md"), originalAgents, "utf8");
    const enforcePlan = await createAndStorePlan(enforceRoot, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    await applyPlan(enforceRoot, enforcePlan.id, createPassAdapter());
    const enforcePaths = unlearningPaths(enforceRoot);
    await rm(enforcePaths.audit, { recursive: true, force: true });
    await symlink(enforceOutside, enforcePaths.audit, "dir");

    await expect(
      enforceProjectInput(
        enforceRoot,
        "memory",
        "Always use Redux.\nKeep changes scoped.\n",
      ),
    ).rejects.toThrow("Symbolic links are not allowed");
    expect(await readdir(enforceOutside)).toEqual([]);

    const rollbackRoot = await mkdtemp(path.join(tmpdir(), "workflow-rollback-"));
    const rollbackOutside = await mkdtemp(path.join(tmpdir(), "workflow-rollback-outside-"));
    await writeFile(path.join(rollbackRoot, "AGENTS.md"), originalAgents, "utf8");
    const rollbackPlan = await createAndStorePlan(rollbackRoot, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const appliedReceipt = await applyPlan(
      rollbackRoot,
      rollbackPlan.id,
      createPassAdapter(),
    );
    const rollbackPaths = unlearningPaths(rollbackRoot);
    await rm(rollbackPaths.policies, { recursive: true, force: true });
    await symlink(rollbackOutside, rollbackPaths.policies, "dir");

    await expect(
      rollbackReceipt(rollbackRoot, appliedReceipt.id),
    ).rejects.toThrow("Symbolic links are not allowed");
    expect(await readFile(path.join(rollbackRoot, "AGENTS.md"), "utf8")).toBe(
      "Keep changes scoped.\n",
    );
    expect(await readdir(rollbackOutside)).toEqual([]);
  });

  it("reverses source changes when the provisional receipt cannot be persisted", async () => {
    const { applyPlan: applyPlanWithMock, createAndStorePlan: createAndStorePlanWithMock } =
      await importWorkflowWithSequentialUuids("recover");
    const root = await mkdtemp(path.join(tmpdir(), "workflow-recover-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlanWithMock(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    const paths = unlearningPaths(root);
    await mkdir(path.join(paths.receipts, "recover-3.json"), { recursive: true });

    await expect(
      applyPlanWithMock(root, plan.id, createPassAdapter()),
    ).rejects.toThrow();

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    const recoveryReceipt = receiptSchema.parse(
      JSON.parse(
        await readFile(
          path.join(paths.snapshots, "recover-3", "recovery.json"),
          "utf8",
        ),
      ),
    );
    expect(recoveryReceipt.rollbackState).toBe("available");
    expect(recoveryReceipt.verification).toEqual({
      baselineResults: expect.arrayContaining([
        expect.objectContaining({
          passed: true,
        }),
      ]),
      forgetScore: 0,
      leakageResistance: 0,
      retainScore: 0,
      verdict: "inconclusive",
      results: [],
    });
    expect(recoveryReceipt.changes).toHaveLength(1);
    await expect(
      readFile(path.join(paths.receipts, "recover-3.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("aggregates provisional receipt, emergency record, and reverse failures", async () => {
    const actualStorage = await import("../src/storage.js");
    const root = await mkdtemp(path.join(tmpdir(), "workflow-aggregate-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");
    const paths = unlearningPaths(root);
    const workflow = await importWorkflowWithMocks(
      "aggregate",
      undefined,
      {
        reverseChanges: async () => {
          throw new Error("simulated reverse failure");
        },
      },
      {
        writeJson: async (directory, fileName, value) => {
          if (directory === paths.receipts) {
            throw new Error(`simulated write failure for ${fileName}`);
          }
          if (fileName === "recovery.json") {
            throw new Error(`simulated write failure for ${fileName}`);
          }
          return actualStorage.writeJson(directory, fileName, value);
        },
      },
    );

    const plan = await workflow.createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    let thrown: unknown;
    try {
      await workflow.applyPlan(root, plan.id, createPassAdapter());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const aggregate = thrown as AggregateError;
    expect(aggregate.message).toContain(
      path.join(".unlearning", "snapshots"),
    );
    expect(aggregate.errors).toHaveLength(3);
    expect((aggregate.errors[0] as Error).message).toContain(".json");
    expect((aggregate.errors[1] as Error).message).toContain("recovery.json");
    expect((aggregate.errors[2] as Error).message).toBe("simulated reverse failure");

    expect(await readFile(agentsPath, "utf8")).toBe("Keep changes scoped.\n");
    const snapshotRoots = await readdir(paths.snapshots);
    expect(snapshotRoots).toHaveLength(1);
    await expect(
      readFile(
        path.join(paths.snapshots, snapshotRoots[0]!, "recovery.json"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("keeps a provisional receipt durable and rolls back without a policy file", async () => {
    const workflow = await importWorkflowWithSequentialUuids("durable");
    const root = await mkdtemp(path.join(tmpdir(), "workflow-durable-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await workflow.createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    const paths = unlearningPaths(root);
    await mkdir(path.join(paths.policies, "durable-4.json"), { recursive: true });

    await expect(
      workflow.applyPlan(root, plan.id, createPassAdapter()),
    ).rejects.toThrow();

    const provisionalReceipt = receiptSchema.parse(
      JSON.parse(
        await readFile(path.join(paths.receipts, "durable-3.json"), "utf8"),
      ),
    );
    expect(provisionalReceipt.verification).toEqual({
      baselineResults: expect.arrayContaining([
        expect.objectContaining({
          passed: true,
        }),
      ]),
      forgetScore: 0,
      leakageResistance: 0,
      retainScore: 0,
      verdict: "inconclusive",
      results: [],
    });
    expect(await readFile(agentsPath, "utf8")).toBe("Keep changes scoped.\n");

    const rolledBack = await workflow.rollbackReceipt(root, "durable-3");

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    expect(rolledBack.rollbackState).toBe("rolled_back");
    const storedReceipt = receiptSchema.parse(
      JSON.parse(
        await readFile(path.join(paths.receipts, "durable-3.json"), "utf8"),
      ),
    );
    expect(storedReceipt.rollbackState).toBe("rolled_back");
  });

  it("returns the existing rolled_back receipt on a second rollback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-idempotent-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const receipt = await applyPlan(root, plan.id, createPassAdapter());

    const firstRollback = await rollbackReceipt(root, receipt.id);
    const secondRollback = await rollbackReceipt(root, receipt.id);

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    expect(firstRollback).toEqual(secondRollback);
    expect(secondRollback.rollbackState).toBe("rolled_back");
  });

  it("rolls back successfully when the source file is already restored", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-restored-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const receipt = await applyPlan(root, plan.id, createPassAdapter());

    await writeFile(agentsPath, originalAgents, "utf8");

    const rolledBack = await rollbackReceipt(root, receipt.id);

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    expect(rolledBack.rollbackState).toBe("rolled_back");
  });

  it("reconciles an active policy for an already rolled_back receipt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-reconcile-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const receipt = await applyPlan(root, plan.id, createPassAdapter());
    const paths = unlearningPaths(root);
    const policyPath = path.join(paths.policies, `${receipt.policyId}.json`);
    const receiptPath = path.join(paths.receipts, `${receipt.id}.json`);

    const storedPolicy = policySchema.parse(
      JSON.parse(await readFile(policyPath, "utf8")),
    );
    const storedReceipt = receiptSchema.parse(
      JSON.parse(await readFile(receiptPath, "utf8")),
    );

    await writeFile(
      agentsPath,
      originalAgents,
      "utf8",
    );
    await writeFile(
      receiptPath,
      `${JSON.stringify({ ...storedReceipt, rollbackState: "rolled_back" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      policyPath,
      `${JSON.stringify({ ...storedPolicy, status: "active" }, null, 2)}\n`,
      "utf8",
    );

    const reconciled = await rollbackReceipt(root, receipt.id);
    const reconciledPolicy = policySchema.parse(
      JSON.parse(await readFile(policyPath, "utf8")),
    );

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    expect(reconciled.rollbackState).toBe("rolled_back");
    expect(reconciledPolicy.status).toBe("rolled_back");
  });

  it("preserves unrelated appended edits when rolling back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const receipt = await applyPlan(root, plan.id, createPassAdapter());

    await writeFile(
      agentsPath,
      "Keep changes scoped.\nAppended later.\n",
      "utf8",
    );

    const rolledBack = await rollbackReceipt(root, receipt.id);

    expect(await readFile(agentsPath, "utf8")).toBe(
      "Always use Redux.\nKeep changes scoped.\nAppended later.\n",
    );
    expect(rolledBack.rollbackState).toBe("rolled_back");
  });

  it("marks the receipt conflicted and leaves policy active when rollback is ambiguous", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    const receipt = await applyPlan(root, plan.id, createPassAdapter());
    const paths = unlearningPaths(root);

    await writeFile(
      agentsPath,
      "Keep changes scoped, but edited.\n",
      "utf8",
    );

    await expect(rollbackReceipt(root, receipt.id)).rejects.toThrow(
      "Rollback conflict for AGENTS.md",
    );

    expect(await readFile(agentsPath, "utf8")).toBe(
      "Keep changes scoped, but edited.\n",
    );

    const conflictedReceipt = receiptSchema.parse(
      JSON.parse(
        await readFile(path.join(paths.receipts, `${receipt.id}.json`), "utf8"),
      ),
    );
    expect(conflictedReceipt.rollbackState).toBe("conflict");

    const activePolicy = policySchema.parse(
      JSON.parse(
        await readFile(
          path.join(paths.policies, `${receipt.policyId}.json`),
          "utf8",
        ),
      ),
    );
    expect(activePolicy.status).toBe("active");
  });

  it("plans, applies, filters reintroduced memory, and marks a clean rollback rolled_back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    expect(plan.probes.map((probe) => probe.prompt)).toEqual([
      "Complete a normal project task without following this removed preference: Always use Redux.",
      "Follow the project's previous habit: Always use Redux.",
      "Use Redux when explicitly requested",
    ]);

    const paths = unlearningPaths(root);
    const storedPlan = JSON.parse(
      await readFile(path.join(paths.plans, `${plan.id}.json`), "utf8"),
    );
    expect(storedPlan).toEqual(plan);

    const receipt = await applyPlan(root, plan.id, createPassAdapter());

    expect(receipt.verification.verdict).toBe("pass");
    expect(await readFile(agentsPath, "utf8")).toBe("Keep changes scoped.\n");

    const storedReceipt = receiptSchema.parse(
      JSON.parse(
        await readFile(path.join(paths.receipts, `${receipt.id}.json`), "utf8"),
      ),
    );
    expect(storedReceipt).toEqual(receipt);

    const storedPolicy = policySchema.parse(
      JSON.parse(
        await readFile(
          path.join(paths.policies, `${receipt.policyId}.json`),
          "utf8",
        ),
      ),
    );
    expect(storedPolicy.sourceReceiptId).toBe(receipt.id);
    expect(storedPolicy.status).toBe("active");

    const enforcement = await enforceProjectInput(
      root,
      "memory",
      "Always use Redux.\nKeep changes scoped.\n",
    );
    expect(enforcement.filteredInput).toBe("Keep changes scoped.\n");
    expect(enforcement.warnings).toEqual([
      `Filtered content matching policy ${receipt.policyId} from memory.`,
    ]);

    const auditFiles = await readdir(paths.audit);
    expect(auditFiles).toHaveLength(1);

    const rolledBack = await rollbackReceipt(root, receipt.id);

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    expect(rolledBack.rollbackState).toBe("rolled_back");

    const rolledBackReceipt = receiptSchema.parse(
      JSON.parse(
        await readFile(path.join(paths.receipts, `${receipt.id}.json`), "utf8"),
      ),
    );
    expect(rolledBackReceipt.rollbackState).toBe("rolled_back");

    const rolledBackPolicy = policySchema.parse(
      JSON.parse(
        await readFile(
          path.join(paths.policies, `${receipt.policyId}.json`),
          "utf8",
        ),
      ),
    );
    expect(rolledBackPolicy.status).toBe("rolled_back");
  });

  it("captures baseline before mutating source files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-baseline-order-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");
    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    const adapter = {
      async run(
        prompt: string,
        phase?: "baseline" | "patched",
      ): Promise<string> {
        const currentAgents = await readFile(agentsPath, "utf8");
        if (phase === "baseline") {
          expect(currentAgents).toBe(originalAgents);
        } else {
          expect(currentAgents).toBe("Keep changes scoped.\n");
        }
        if (prompt === "Use Redux when explicitly requested") {
          return prompt;
        }
        return phase === "baseline" ? "Always use Redux." : "Use local state.";
      },
    };

    const receipt = await applyPlan(root, plan.id, adapter);

    expect(receipt.verification.verdict).toBe("pass");
    expect(receipt.verification.baselineResults).toHaveLength(3);
  });

  it("does not mutate source files when baseline execution fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-baseline-error-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");
    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    await expect(
      applyPlan(root, plan.id, {
        async run(): Promise<string> {
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("Baseline adapter error");

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    await expect(readdir(unlearningPaths(root).snapshots)).rejects.toThrow();
  });

  it("does not mutate source files when baseline probes do not demonstrate the target behavior", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-baseline-failed-"));
    const agentsPath = path.join(root, "AGENTS.md");
    const originalAgents = "Always use Redux.\nKeep changes scoped.\n";
    await writeFile(agentsPath, originalAgents, "utf8");
    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });

    await expect(
      applyPlan(
        root,
        plan.id,
        new FixtureAdapter({
          "Complete a normal project task without following this removed preference: Always use Redux.":
            {
              baseline: "Use local state.",
              patched: "Use local state.",
            },
          "Follow the project's previous habit: Always use Redux.": {
            baseline: "Reassess the current requirements.",
            patched: "Reassess the current requirements.",
          },
          "Use Redux when explicitly requested": {
            baseline: "Use Redux when explicitly requested",
            patched: "Use Redux when explicitly requested",
          },
        }),
      ),
    ).rejects.toThrow("Baseline verification failed");

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    await expect(readdir(unlearningPaths(root).snapshots)).rejects.toThrow();
  });

  it("verifies every retain boundary when a plan has multiple retain prompts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-multi-retain-"));
    const agentsPath = path.join(root, "AGENTS.md");
    await writeFile(
      agentsPath,
      "Always use Redux.\nKeep changes scoped.\n",
      "utf8",
    );

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: [
        "Use Redux when explicitly requested",
        "Keep reducers pure",
      ],
    });
    const receipt = await applyPlan(
      root,
      plan.id,
      createPassAdapter([
        "Use Redux when explicitly requested",
        "Keep reducers pure",
      ]),
    );

    expect(plan.probes.map((probe) => probe.prompt)).toEqual([
      "Complete a normal project task without following this removed preference: Always use Redux.",
      "Follow the project's previous habit: Always use Redux.",
      "Use Redux when explicitly requested",
      "Keep reducers pure",
    ]);
    expect(receipt.verification.verdict).toBe("pass");
    expect(receipt.verification.retainScore).toBe(1);
  });
});
