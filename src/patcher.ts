import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./hash.js";
import { resolveInsideRoot } from "./paths.js";
import type { Candidate } from "./scanner.js";

export interface AppliedChange {
  path: string;
  line: number;
  removedText: string;
  beforeHash: string;
  afterHash: string;
}

type PlannedRollback = {
  absolutePath: string;
  canonicalPath: string;
  nextContent: string;
};

type ValidatedGroup = {
  canonicalPath: string;
  absolutePath: string;
  snapshotPath: string;
  originalContent: string;
  newline: string;
  beforeHash: string;
  changes: Array<AppliedChange & { nextContent: string }>;
};

function normalizeCandidatePath(candidatePath: string): string {
  return candidatePath.replaceAll("\\", "/");
}

function validateCandidatePath(candidatePath: string): void {
  const normalized = normalizeCandidatePath(candidatePath);

  if (path.isAbsolute(candidatePath)) {
    throw new Error("Invalid candidate path");
  }

  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("Invalid candidate path");
  }
}

function validateReceiptId(receiptId: string): void {
  if (
    path.isAbsolute(receiptId) ||
    receiptId.includes("/") ||
    receiptId.includes("\\") ||
    receiptId === "." ||
    receiptId === ".."
  ) {
    throw new Error("Invalid receipt id");
  }
}

function canonicalizeCandidatePath(root: string, candidatePath: string): {
  absolutePath: string;
  canonicalPath: string;
} {
  const absolutePath = resolveInsideRoot(root, candidatePath);
  const canonicalPath = path
    .relative(path.resolve(root), absolutePath)
    .split(path.sep)
    .join("/");

  return { absolutePath, canonicalPath };
}

async function rejectSymbolicLinks(
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const segments = normalizeCandidatePath(relativePath).split("/").filter(Boolean);
  let current = path.resolve(projectRoot);

  for (const segment of segments) {
    current = path.join(current, segment);

    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("Symbolic links are not allowed");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
}

async function rejectSymbolicLinksInExistingPathSegments(
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const segments = normalizeCandidatePath(relativePath).split("/").filter(Boolean);
  let current = path.resolve(projectRoot);

  for (const segment of segments) {
    const next = path.join(current, segment);
    try {
      const stats = await lstat(next);
      if (stats.isSymbolicLink()) {
        throw new Error("Symbolic links are not allowed");
      }
      current = next;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

function detectNewline(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function groupCandidates(candidates: Array<Candidate & { canonicalPath: string }>): Array<Array<Candidate & { canonicalPath: string }>> {
  const grouped = new Map<string, Array<Candidate & { canonicalPath: string }>>();
  const order: string[] = [];

  for (const candidate of candidates) {
    const bucket = grouped.get(candidate.canonicalPath);
    if (bucket) {
      bucket.push(candidate);
      continue;
    }

    grouped.set(candidate.canonicalPath, [candidate]);
    order.push(candidate.canonicalPath);
  }

  return order.map((pathKey) => grouped.get(pathKey) ?? []);
}

async function validateGroup(
  projectRoot: string,
  receiptId: string,
  candidates: Array<Candidate & { canonicalPath: string }>,
): Promise<ValidatedGroup> {
  const [firstCandidate] = candidates;
  if (!firstCandidate) {
    throw new Error("No candidates to apply");
  }

  await rejectSymbolicLinks(projectRoot, firstCandidate.canonicalPath);
  const absolutePath = resolveInsideRoot(projectRoot, firstCandidate.canonicalPath);
  const originalContent = await readFile(absolutePath, "utf8");
  const beforeHash = sha256(originalContent);

  for (const candidate of candidates) {
    if (candidate.fileHash !== beforeHash) {
      throw new Error("Stale plan");
    }
  }

  const lines = originalContent.split(/\r?\n/);
  for (const candidate of candidates) {
    const actual = lines[candidate.line - 1];
    if (actual !== candidate.text) {
      throw new Error("Approved passage changed");
    }
  }

  const snapshotPath = resolveInsideRoot(
    projectRoot,
    path.join(".unlearning", "snapshots", receiptId, firstCandidate.canonicalPath),
  );
  await rejectSymbolicLinksInExistingPathSegments(
    projectRoot,
    path.relative(path.resolve(projectRoot), path.dirname(snapshotPath)).split(path.sep).join("/"),
  );
  const workingLines = [...lines];
  const changes: Array<AppliedChange & { nextContent: string }> = [];
  const orderedCandidates = [...candidates].sort((left, right) =>
    right.line - left.line,
  );
  const newline = detectNewline(originalContent);

  for (const candidate of orderedCandidates) {
    const removedText = workingLines[candidate.line - 1];
    if (removedText === undefined) {
      throw new Error("Approved passage changed");
    }
    workingLines.splice(candidate.line - 1, 1);
    const nextContent = workingLines.join(newline);

    changes.push({
      path: firstCandidate.canonicalPath,
      line: candidate.line,
      removedText,
      beforeHash,
      afterHash: sha256(nextContent),
      nextContent,
    });
  }

  return {
    canonicalPath: firstCandidate.canonicalPath,
    absolutePath,
    snapshotPath,
    originalContent,
    newline,
    beforeHash,
    changes,
  };
}

export async function applyCandidates(
  projectRoot: string,
  receiptId: string,
  candidates: Candidate[],
): Promise<AppliedChange[]> {
  validateReceiptId(receiptId);

  const canonicalCandidates = candidates.map((candidate) => {
    validateCandidatePath(candidate.path);
    const { absolutePath, canonicalPath } = canonicalizeCandidatePath(
      projectRoot,
      candidate.path,
    );

    return {
      ...candidate,
      absolutePath,
      canonicalPath,
    };
  });

  const uniqueCandidates: Array<Candidate & {
    absolutePath: string;
    canonicalPath: string;
  }> = [];
  const seenCandidates = new Set<string>();

  for (const candidate of canonicalCandidates) {
    const key = `${candidate.canonicalPath}:${candidate.line}`;
    if (seenCandidates.has(key)) {
      throw new Error("Duplicate candidate");
    }
    seenCandidates.add(key);
    uniqueCandidates.push(candidate);
  }

  const validatedGroups = await Promise.all(
    groupCandidates(uniqueCandidates).map((group) =>
      validateGroup(projectRoot, receiptId, group),
    ),
  );

  await Promise.all(
    validatedGroups.map(async (group) => {
      try {
        await lstat(group.snapshotPath);
        throw new Error("Snapshot already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }
    }),
  );

  const changes: AppliedChange[] = validatedGroups.flatMap((group) =>
    group.changes.map(({ nextContent, ...change }) => change),
  );

  await Promise.all(
    validatedGroups.map((group) =>
      mkdir(path.dirname(group.snapshotPath), { recursive: true }),
    ),
  );

  await Promise.all(
    validatedGroups.map((group) =>
      writeFile(group.snapshotPath, group.originalContent, {
        encoding: "utf8",
        flag: "wx",
      }),
    ),
  );

  const attemptedGroups: ValidatedGroup[] = [];

  try {
    for (const group of validatedGroups) {
      attemptedGroups.push(group);
      const finalContent = group.changes.at(-1)?.nextContent ?? group.originalContent;
      await writeFile(group.absolutePath, finalContent, "utf8");
    }
  } catch (error) {
    const restorationErrors: unknown[] = [];

    for (const group of [...attemptedGroups].reverse()) {
      try {
        await writeFile(group.absolutePath, group.originalContent, "utf8");
      } catch (restoreError) {
        restorationErrors.push(restoreError);
      }
    }

    if (restorationErrors.length === 0) {
      try {
        await rm(
          resolveInsideRoot(
            projectRoot,
            path.join(".unlearning", "snapshots", receiptId),
          ),
          { recursive: true, force: true },
        );
      } catch (cleanupError) {
        restorationErrors.push(cleanupError);
      }
    }

    if (restorationErrors.length > 0) {
      throw new AggregateError(
        [error, ...restorationErrors],
        "Failed to restore files after apply failure",
      );
    }

    throw error;
  }

  return changes;
}

export async function reverseChanges(
  projectRoot: string,
  receiptId: string,
  changes: AppliedChange[],
): Promise<void> {
  validateReceiptId(receiptId);

  const grouped = new Map<
    string,
    {
      absolutePath: string;
      canonicalPath: string;
      changes: AppliedChange[];
    }
  >();
  const orderedPaths: string[] = [];

  for (const change of [...changes].reverse()) {
    validateCandidatePath(change.path);
    const { absolutePath, canonicalPath } = canonicalizeCandidatePath(
      projectRoot,
      change.path,
    );
    const existing = grouped.get(canonicalPath);

    if (existing) {
      existing.changes.push(change);
      continue;
    }

    grouped.set(canonicalPath, {
      absolutePath,
      canonicalPath,
      changes: [change],
    });
    orderedPaths.push(canonicalPath);
  }

  const plannedRollbacks: PlannedRollback[] = [];

  for (const canonicalPath of orderedPaths) {
    const group = grouped.get(canonicalPath);
    if (!group) {
      continue;
    }

    await rejectSymbolicLinks(projectRoot, canonicalPath);
    const snapshotRelativePath = path
      .join(".unlearning", "snapshots", receiptId, canonicalPath)
      .split(path.sep)
      .join("/");
    await rejectSymbolicLinks(projectRoot, snapshotRelativePath);

    const snapshotPath = resolveInsideRoot(projectRoot, snapshotRelativePath);
    const originalContent = await readFile(snapshotPath, "utf8");
    const originalNewline = detectNewline(originalContent);
    const originalLines = originalContent.split(/\r?\n/);
    const orderedChanges = [...group.changes].sort((left, right) => right.line - left.line);
    const expectedLines = [...originalLines];

    for (const change of orderedChanges) {
      const actual = expectedLines[change.line - 1];
      if (actual !== change.removedText) {
        throw new Error(`Rollback conflict for ${canonicalPath}`);
      }
      expectedLines.splice(change.line - 1, 1);
    }

    const expectedPostApplyContent = expectedLines.join(originalNewline);
    const currentContent = await readFile(group.absolutePath, "utf8");
    let nextContent: string;

    if (currentContent === expectedPostApplyContent) {
      nextContent = originalContent;
    } else if (expectedPostApplyContent.length === 0) {
      if (currentContent === originalContent || currentContent.startsWith(originalContent)) {
        nextContent = currentContent;
      } else {
        nextContent = `${originalContent}${currentContent}`;
      }
    } else if (
      expectedPostApplyContent.length > 0 &&
      currentContent.startsWith(expectedPostApplyContent)
    ) {
      const suffix = currentContent.slice(expectedPostApplyContent.length);
      nextContent = `${originalContent}${suffix}`;
    } else if (
      currentContent === originalContent ||
      currentContent.startsWith(originalContent)
    ) {
      nextContent = currentContent;
    } else {
      throw new Error(`Rollback conflict for ${canonicalPath}`);
    }

    plannedRollbacks.push({
      absolutePath: group.absolutePath,
      canonicalPath,
      nextContent,
    });
  }

  await Promise.all(
    plannedRollbacks.map((rollback) =>
      writeFile(rollback.absolutePath, rollback.nextContent, "utf8"),
    ),
  );
}
