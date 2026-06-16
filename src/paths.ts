import path from "node:path";

export function resolveInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes project root");
  }

  return resolvedCandidate;
}

export function unlearningPaths(root: string) {
  const base = path.resolve(root, ".unlearning");

  return {
    base,
    plans: path.join(base, "plans"),
    policies: path.join(base, "policies"),
    receipts: path.join(base, "receipts"),
    snapshots: path.join(base, "snapshots"),
    audit: path.join(base, "audit"),
  };
}
