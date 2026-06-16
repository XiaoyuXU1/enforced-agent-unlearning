import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { AgentAdapter } from "./adapters/types.js";
import { enforceInput, type EnforcementResult } from "./enforcement.js";
import { applyCandidates, reverseChanges } from "./patcher.js";
import { resolveInsideRoot, unlearningPaths } from "./paths.js";
import { createPlan } from "./planner.js";
import { createPolicy, rollBackPolicy } from "./policy.js";
import { scanProject } from "./scanner.js";
import {
  manifestSchema,
  planSchema,
  policySchema,
  receiptSchema,
  type AuditEvent,
  type Plan,
  type Receipt,
  type Verification,
} from "./schema.js";
import { readJson, writeJson } from "./storage.js";
import { captureBaseline, verifyPlan } from "./verifier.js";

function createProvisionalVerification(
  baselineResults: Verification["baselineResults"],
): Verification {
  return {
    baselineResults,
    forgetScore: 0,
    leakageResistance: 0,
    retainScore: 0,
    verdict: "inconclusive",
    results: [],
  };
}

function assertBaselineSuccessful(
  baselineResults: Verification["baselineResults"],
): void {
  const failed = baselineResults.find((result) => !result.passed);
  if (failed) {
    throw new Error(`Baseline verification failed for ${failed.probeId}`);
  }
}

function jsonFilePath(directory: string, id: string): string {
  return path.join(directory, `${id}.json`);
}

function aggregateApplyRecoveryError(
  emergencyRecoveryPath: string,
  errors: unknown[],
): AggregateError {
  return new AggregateError(
    errors,
    `Apply recovery failed. Emergency recovery record: ${emergencyRecoveryPath}`,
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (((error as NodeJS.ErrnoException).code === "ENOENT") ||
      ((error as NodeJS.ErrnoException).code === "EISDIR") ||
      ((error as NodeJS.ErrnoException).code === "ENOTDIR"))
  );
}

function normalizeRootForComparison(rootPath: string): string {
  return process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
}

async function canonicalProjectRoot(projectRoot: string): Promise<string> {
  const resolvedRoot = path.resolve(projectRoot);
  try {
    return await realpath(resolvedRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return resolvedRoot;
    }
    throw error;
  }
}

function relativeControlPath(canonicalRoot: string, absolutePath: string): string {
  const relativePath = path.relative(canonicalRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Path escapes project root");
  }
  return relativePath.split(path.sep).join("/");
}

async function rejectSymbolicLinks(
  canonicalRoot: string,
  relativePath: string,
): Promise<void> {
  const segments = relativePath.split("/").filter(Boolean);
  let current = canonicalRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("Symbolic links are not allowed");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function ensureSafeControlDirectory(
  canonicalRoot: string,
  directory: string,
  createMissing: boolean,
): Promise<void> {
  const absoluteDirectory = resolveInsideRoot(
    canonicalRoot,
    relativeControlPath(canonicalRoot, path.resolve(directory)),
  );
  const relativePath = relativeControlPath(canonicalRoot, absoluteDirectory);

  await rejectSymbolicLinks(canonicalRoot, relativePath);
  if (createMissing) {
    await mkdir(absoluteDirectory, { recursive: true });
  }
  await rejectSymbolicLinks(canonicalRoot, relativePath);
}

export async function ensureSafeControlDirectories(
  projectRoot: string,
  directories: string[],
  createMissing = true,
): Promise<string> {
  const canonicalRoot = await canonicalProjectRoot(projectRoot);
  for (const directory of directories) {
    await ensureSafeControlDirectory(canonicalRoot, directory, createMissing);
  }
  return canonicalRoot;
}

async function listPolicyFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function persistAuditEvents(
  auditDirectory: string,
  events: AuditEvent[],
): Promise<void> {
  await Promise.all(
    events.map((event) => writeJson(auditDirectory, `${event.id}.json`, event)),
  );
}

async function reconcileRolledBackPolicy(
  policiesDirectory: string,
  policyId: string,
): Promise<void> {
  try {
    const policy = policySchema.parse(
      await readJson<unknown>(jsonFilePath(policiesDirectory, policyId)),
    );
    if (policy.status === "rolled_back") {
      return;
    }
    await writeJson(
      policiesDirectory,
      `${policy.id}.json`,
      rollBackPolicy(policy),
    );
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

export async function createAndStorePlan(
  projectRoot: string,
  manifestInput: unknown,
): Promise<Plan> {
  await ensureSafeControlDirectories(projectRoot, [unlearningPaths(projectRoot).plans]);
  const manifest = manifestSchema.parse(manifestInput);
  const candidates = await scanProject(
    projectRoot,
    manifest.target,
    manifest.scope.include,
  );
  const plan = createPlan(projectRoot, manifest, candidates);
  await writeJson(
    unlearningPaths(projectRoot).plans,
    `${plan.id}.json`,
    plan,
  );
  return plan;
}

export async function applyPlan(
  projectRoot: string,
  planId: string,
  adapter: AgentAdapter,
): Promise<Receipt> {
  const paths = unlearningPaths(projectRoot);
  const canonicalCurrentRoot = await ensureSafeControlDirectories(projectRoot, [
    paths.plans,
    paths.receipts,
    paths.policies,
  ]);
  const plan = planSchema.parse(
    await readJson<unknown>(jsonFilePath(paths.plans, planId)),
  );
  const canonicalPlanRoot = await canonicalProjectRoot(plan.projectRoot);
  if (
    normalizeRootForComparison(canonicalPlanRoot) !==
    normalizeRootForComparison(canonicalCurrentRoot)
  ) {
    throw new Error("Plan project root does not match current project");
  }

  const baselineResults = await captureBaseline(plan, adapter);
  assertBaselineSuccessful(baselineResults);
  const receiptId = randomUUID();
  const policy = createPolicy(plan.manifest, receiptId);
  const changes = await applyCandidates(projectRoot, receiptId, plan.candidates);
  const provisionalReceipt = receiptSchema.parse({
    id: receiptId,
    planId: plan.id,
    policyId: policy.id,
    createdAt: new Date().toISOString(),
    changes,
    verification: createProvisionalVerification(baselineResults),
    rollbackState: "available",
  });

  try {
    await writeJson(paths.receipts, `${provisionalReceipt.id}.json`, provisionalReceipt);
  } catch (error) {
    const emergencyRecoveryPath = path.join(
      paths.snapshots,
      receiptId,
      "recovery.json",
    );
    const recoveryErrors: unknown[] = [error];

    try {
      await writeJson(
        path.join(paths.snapshots, receiptId),
        "recovery.json",
        provisionalReceipt,
      );
    } catch (recoveryError) {
      recoveryErrors.push(recoveryError);
    }

    try {
      await reverseChanges(projectRoot, receiptId, changes);
    } catch (reverseError) {
      recoveryErrors.push(reverseError);
      throw aggregateApplyRecoveryError(emergencyRecoveryPath, recoveryErrors);
    }

    if (recoveryErrors.length > 1) {
      throw aggregateApplyRecoveryError(emergencyRecoveryPath, recoveryErrors);
    }

    throw error;
  }

  await writeJson(paths.policies, `${policy.id}.json`, policy);
  const verification = await verifyPlan(plan, adapter, baselineResults);
  const receipt = receiptSchema.parse({
    ...provisionalReceipt,
    verification,
  });

  await writeJson(paths.receipts, `${receipt.id}.json`, receipt);

  return receipt;
}

export async function enforceProjectInput(
  projectRoot: string,
  source: string,
  input: string,
): Promise<EnforcementResult> {
  const paths = unlearningPaths(projectRoot);
  await ensureSafeControlDirectories(projectRoot, [paths.policies, paths.audit]);
  const policies = await Promise.all(
    (await listPolicyFiles(paths.policies)).map(async (fileName) =>
      policySchema.parse(await readJson<unknown>(path.join(paths.policies, fileName))),
    ),
  );
  const result = enforceInput(source, input, policies);
  await persistAuditEvents(paths.audit, result.events);
  return result;
}

export async function rollbackReceipt(
  projectRoot: string,
  receiptId: string,
): Promise<Receipt> {
  const paths = unlearningPaths(projectRoot);
  await ensureSafeControlDirectories(projectRoot, [paths.receipts, paths.policies]);
  const receipt = receiptSchema.parse(
    await readJson<unknown>(jsonFilePath(paths.receipts, receiptId)),
  );

  if (receipt.rollbackState === "rolled_back") {
    await reconcileRolledBackPolicy(paths.policies, receipt.policyId);
    return receipt;
  }

  try {
    await reverseChanges(projectRoot, receipt.id, receipt.changes);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Rollback conflict for ")) {
      const conflictedReceipt = receiptSchema.parse({
        ...receipt,
        rollbackState: "conflict",
      });
      await writeJson(
        paths.receipts,
        `${conflictedReceipt.id}.json`,
        conflictedReceipt,
      );
    }
    throw error;
  }

  const rolledBackReceipt = receiptSchema.parse({
    ...receipt,
    rollbackState: "rolled_back",
  });

  await writeJson(paths.receipts, `${rolledBackReceipt.id}.json`, rolledBackReceipt);
  await reconcileRolledBackPolicy(paths.policies, receipt.policyId);

  return rolledBackReceipt;
}
