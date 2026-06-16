# Enforced Agent Unlearning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repository-contained Agent Skill and TypeScript CLI that plans approved project-level unlearning, applies guarded edits, persists deny policies, filters reintroduced content in default warn mode, verifies behavior with deterministic fixtures, and supports audited rollback.

**Architecture:** Implement one Node.js package with small provider-neutral modules. The CLI orchestrates schemas, bounded scanning, exact-text planning, guarded patching, persistent policy enforcement, deterministic verification, receipts, and rollback; repository-contained Codex and Claude skill wrappers invoke that same CLI without installing into user-level directories.

**Tech Stack:** TypeScript, Node.js 20+, commander, fast-glob, yaml, zod, vitest, npm

---

## File Map

```text
package.json                         npm scripts and runtime dependencies
tsconfig.json                        strict TypeScript configuration
vitest.config.ts                     test discovery and coverage configuration
src/index.ts                         package exports
src/cli.ts                           command parsing and user-facing output
src/schema.ts                        manifests, plans, policies, receipts, audit types
src/paths.ts                         project-root and .unlearning path safety
src/storage.ts                       JSON persistence with stable formatting
src/hash.ts                          SHA-256 helpers
src/scanner.ts                       bounded discovery and candidate matching
src/planner.ts                       exact-text plan and probe generation
src/patcher.ts                       guarded apply and guarded reverse apply
src/policy.ts                        policy creation, matching, and status changes
src/enforcement.ts                   staged-input filtering and audit creation
src/verifier.ts                      deterministic before/after probe scoring
src/workflow.ts                      plan/apply/verify/rollback orchestration
src/adapters/types.ts                provider-neutral agent adapter contract
src/adapters/fixture.ts              deterministic adapter used by MVP tests
skills/enforced-unlearning/SKILL.md  Codex-compatible workflow instructions
skills/enforced-unlearning/agents/openai.yaml
skills/enforced-unlearning/references/claude-code.md
tests/*.test.ts                      unit and integration tests
tests/fixtures/project/**            sample controlled project
```

The implementation deliberately uses exact target text in the MVP. Semantic matching is represented in the schema but deferred until a real model adapter is tested; this prevents an LLM-generated fuzzy match from silently deleting unrelated content.

### Task 1: Bootstrap the TypeScript Package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
// tests/smoke.test.ts
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("package", () => {
  it("exports a version", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Create package configuration without the implementation**

```json
{
  "name": "enforced-agent-unlearning",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "unlearn": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "commander": "^14.0.0",
    "fast-glob": "^3.3.3",
    "yaml": "^2.8.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
  },
});
```

- [ ] **Step 3: Install dependencies and verify the test fails**

Run: `npm install`

Run: `npm test -- tests/smoke.test.ts`

Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 4: Add the minimal package export**

```ts
// src/index.ts
export const VERSION = "0.1.0";
```

- [ ] **Step 5: Verify bootstrap**

Run: `npm test -- tests/smoke.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/package.json Agent_unlearning_test/package-lock.json Agent_unlearning_test/tsconfig.json Agent_unlearning_test/vitest.config.ts Agent_unlearning_test/src/index.ts Agent_unlearning_test/tests/smoke.test.ts
git commit -m "chore: bootstrap enforced unlearning package"
```

### Task 2: Define Validated Domain Schemas

**Files:**
- Create: `src/schema.ts`
- Create: `tests/schema.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write schema tests**

```ts
// tests/schema.test.ts
import { describe, expect, it } from "vitest";
import {
  enforcementModeSchema,
  manifestSchema,
  verdictSchema,
} from "../src/schema.js";

describe("schemas", () => {
  it("defaults enforcement to warn", () => {
    const value = manifestSchema.parse({
      target: "Always use Redux",
      retain: ["Use Redux when explicitly requested"],
    });

    expect(value.enforcement.mode).toBe("warn");
    expect(value.success).toEqual({
      forgetThreshold: 0.9,
      leakageThreshold: 0.8,
      retainThreshold: 0.9,
    });
  });

  it("rejects empty forget targets", () => {
    expect(() => manifestSchema.parse({ target: " " })).toThrow();
  });

  it("defines the supported modes and verdicts", () => {
    expect(enforcementModeSchema.options).toEqual(["observe", "warn", "block"]);
    expect(verdictSchema.options).toEqual([
      "pass",
      "partial_pass",
      "fail",
      "inconclusive",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm test -- tests/schema.test.ts`

Expected: FAIL because `src/schema.ts` does not exist.

- [ ] **Step 3: Implement schemas and exported types**

```ts
// src/schema.ts
import { z } from "zod";

export const enforcementModeSchema = z.enum(["observe", "warn", "block"]);
export const verdictSchema = z.enum([
  "pass",
  "partial_pass",
  "fail",
  "inconclusive",
]);

export const manifestSchema = z.object({
  target: z.string().trim().min(1),
  scope: z.object({
    include: z.array(z.string()).default([]),
  }).default({ include: [] }),
  retain: z.array(z.string().trim().min(1)).default([]),
  enforcement: z.object({
    mode: enforcementModeSchema.default("warn"),
  }).default({ mode: "warn" }),
  success: z.object({
    forgetThreshold: z.number().min(0).max(1).default(0.9),
    leakageThreshold: z.number().min(0).max(1).default(0.8),
    retainThreshold: z.number().min(0).max(1).default(0.9),
  }).default({
    forgetThreshold: 0.9,
    leakageThreshold: 0.8,
    retainThreshold: 0.9,
  }),
});

export const candidateSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
  fileHash: z.string(),
});

export const probeSchema = z.object({
  id: z.string(),
  kind: z.enum(["forget", "leakage", "retain"]),
  prompt: z.string(),
  forbiddenText: z.string().optional(),
  requiredText: z.string().optional(),
});

export const planSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  projectRoot: z.string(),
  manifest: manifestSchema,
  candidates: z.array(candidateSchema),
  probes: z.array(probeSchema),
});

export const policySchema = z.object({
  id: z.string(),
  target: z.string(),
  retain: z.array(z.string()),
  mode: enforcementModeSchema,
  status: z.enum(["active", "disabled", "rolled_back"]),
  createdAt: z.string(),
  sourceReceiptId: z.string(),
});

export const probeResultSchema = z.object({
  probeId: z.string(),
  passed: z.boolean(),
  output: z.string(),
});

export const verificationSchema = z.object({
  forgetScore: z.number(),
  leakageResistance: z.number(),
  retainScore: z.number(),
  verdict: verdictSchema,
  results: z.array(probeResultSchema),
});

export const receiptSchema = z.object({
  id: z.string(),
  planId: z.string(),
  policyId: z.string(),
  createdAt: z.string(),
  changes: z.array(z.object({
    path: z.string(),
    beforeHash: z.string(),
    afterHash: z.string(),
    removedText: z.string(),
    line: z.number().int().positive(),
  })),
  verification: verificationSchema,
  rollbackState: z.enum(["available", "rolled_back", "conflict"]),
});

export const auditEventSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  createdAt: z.string(),
  source: z.string(),
  matchedHash: z.string(),
  action: z.enum(["observed", "filtered", "blocked"]),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Policy = z.infer<typeof policySchema>;
export type Probe = z.infer<typeof probeSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
```

```ts
// src/index.ts
export const VERSION = "0.1.0";
export * from "./schema.js";
```

- [ ] **Step 4: Verify schemas**

Run: `npm test -- tests/schema.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add Agent_unlearning_test/src/schema.ts Agent_unlearning_test/src/index.ts Agent_unlearning_test/tests/schema.test.ts
git commit -m "feat: define unlearning domain schemas"
```

### Task 3: Add Safe Paths, Hashing, and Persistence

**Files:**
- Create: `src/paths.ts`
- Create: `src/hash.ts`
- Create: `src/storage.ts`
- Create: `tests/storage.test.ts`

- [ ] **Step 1: Write path and persistence tests**

```ts
// tests/storage.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/hash.js";
import { resolveInsideRoot, unlearningPaths } from "../src/paths.js";
import { readJson, writeJson } from "../src/storage.js";

describe("storage primitives", () => {
  it("rejects paths outside the project root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-root-"));
    expect(() => resolveInsideRoot(root, "../outside.txt")).toThrow(
      "Path escapes project root",
    );
  });

  it("writes stable JSON inside .unlearning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unlearn-root-"));
    const paths = unlearningPaths(root);
    await writeJson(paths.plans, "plan-1.json", { b: 2, a: 1 });

    const raw = await readFile(path.join(paths.plans, "plan-1.json"), "utf8");
    expect(raw).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
    expect(await readJson(paths.plans, "plan-1.json")).toEqual({ a: 1, b: 2 });
  });

  it("hashes content deterministically", () => {
    expect(sha256("forgotten")).toBe(sha256("forgotten"));
    expect(sha256("forgotten")).not.toBe(sha256("retained"));
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/storage.test.ts`

Expected: FAIL because the utility modules do not exist.

- [ ] **Step 3: Implement project-root path enforcement**

```ts
// src/paths.ts
import path from "node:path";

export function resolveInsideRoot(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${candidate}`);
  }
  return resolved;
}

export function unlearningPaths(root: string) {
  const base = resolveInsideRoot(root, ".unlearning");
  return {
    base,
    plans: path.join(base, "plans"),
    policies: path.join(base, "policies"),
    receipts: path.join(base, "receipts"),
    snapshots: path.join(base, "snapshots"),
    audit: path.join(base, "audit"),
  };
}
```

- [ ] **Step 4: Implement hashing and stable JSON**

```ts
// src/hash.ts
import { createHash } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
```

```ts
// src/storage.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export async function writeJson(
  directory: string,
  filename: string,
  value: unknown,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, filename);
  await writeFile(destination, `${JSON.stringify(sortValue(value), null, 2)}\n`);
  return destination;
}

export async function readJson(
  directory: string,
  filename: string,
): Promise<unknown> {
  return JSON.parse(await readFile(path.join(directory, filename), "utf8"));
}
```

- [ ] **Step 5: Verify utilities**

Run: `npm test -- tests/storage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/src/paths.ts Agent_unlearning_test/src/hash.ts Agent_unlearning_test/src/storage.ts Agent_unlearning_test/tests/storage.test.ts
git commit -m "feat: add safe unlearning persistence"
```

### Task 4: Scan Only Supported Project-Controlled Inputs

**Files:**
- Create: `src/scanner.ts`
- Create: `tests/scanner.test.ts`
- Create: `tests/fixtures/project/AGENTS.md`
- Create: `tests/fixtures/project/src/app.ts`
- Create: `tests/fixtures/project/.codex/memory.md`

- [ ] **Step 1: Create scanner fixtures**

```markdown
<!-- tests/fixtures/project/AGENTS.md -->
# Agent Rules

Always use Redux for shared state.
Keep changes narrowly scoped.
```

```ts
// tests/fixtures/project/src/app.ts
export const note = "Always use Redux for shared state.";
```

```markdown
<!-- tests/fixtures/project/.codex/memory.md -->
The project prefers Redux.
```

- [ ] **Step 2: Write scanner tests**

```ts
// tests/scanner.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanProject } from "../src/scanner.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "project",
);

describe("scanProject", () => {
  it("finds exact target text in supported instruction files", async () => {
    const candidates = await scanProject(
      fixtureRoot,
      "Always use Redux for shared state.",
      [],
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe("AGENTS.md");
    expect(candidates[0]?.line).toBe(3);
  });

  it("does not scan source code by default", async () => {
    const candidates = await scanProject(
      fixtureRoot,
      "export const note",
      [],
    );
    expect(candidates).toEqual([]);
  });

  it("accepts an explicit supported memory path", async () => {
    const candidates = await scanProject(
      fixtureRoot,
      "The project prefers Redux.",
      [".codex/memory.md"],
    );
    expect(candidates[0]?.path).toBe(".codex/memory.md");
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/scanner.test.ts`

Expected: FAIL because `scanProject` does not exist.

- [ ] **Step 4: Implement bounded exact-text scanning**

```ts
// src/scanner.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { sha256 } from "./hash.js";
import { resolveInsideRoot } from "./paths.js";
import type { z } from "zod";
import { candidateSchema } from "./schema.js";

export type Candidate = z.infer<typeof candidateSchema>;

const DEFAULT_PATTERNS = [
  "AGENTS.md",
  "CLAUDE.md",
  "SKILL.md",
  ".agents/**/*.{md,yaml,yml,json,txt}",
  ".claude/**/*.{md,yaml,yml,json,txt}",
  ".codex/**/*.{md,yaml,yml,json,txt}",
];

const IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/.unlearning/**",
];

export async function scanProject(
  projectRoot: string,
  target: string,
  explicitPaths: string[],
): Promise<Candidate[]> {
  const patterns = [...DEFAULT_PATTERNS, ...explicitPaths];
  const files = await fg(patterns, {
    cwd: projectRoot,
    onlyFiles: true,
    unique: true,
    dot: true,
    ignore: IGNORE,
  });

  const candidates: Candidate[] = [];
  for (const relativePath of files.sort()) {
    const absolutePath = resolveInsideRoot(projectRoot, relativePath);
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (lineText.includes(target)) {
        candidates.push({
          path: relativePath.split(path.sep).join("/"),
          line: index + 1,
          text: lineText,
          fileHash: sha256(content),
        });
      }
    });
  }
  return candidates;
}
```

- [ ] **Step 5: Verify scanner**

Run: `npm test -- tests/scanner.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/src/scanner.ts Agent_unlearning_test/tests/scanner.test.ts Agent_unlearning_test/tests/fixtures/project
git commit -m "feat: scan bounded agent instruction sources"
```

### Task 5: Generate Immutable Plans and Deterministic Probes

**Files:**
- Create: `src/planner.ts`
- Create: `tests/planner.test.ts`

- [ ] **Step 1: Write planner tests**

```ts
// tests/planner.test.ts
import { describe, expect, it } from "vitest";
import { createPlan } from "../src/planner.js";

describe("createPlan", () => {
  it("creates stable probes and preserves the retain boundary", () => {
    const plan = createPlan(
      "C:/project",
      {
        target: "Always use Redux",
        retain: ["Use Redux when explicitly requested"],
      },
      [{
        path: "AGENTS.md",
        line: 3,
        text: "Always use Redux.",
        fileHash: "abc",
      }],
      "2026-06-14T00:00:00.000Z",
    );

    expect(plan.manifest.enforcement.mode).toBe("warn");
    expect(plan.probes.map((probe) => probe.kind)).toEqual([
      "forget",
      "leakage",
      "retain",
    ]);
    expect(plan.probes[2]?.requiredText).toBe(
      "Use Redux when explicitly requested",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/planner.test.ts`

Expected: FAIL because `createPlan` does not exist.

- [ ] **Step 3: Implement normalized plan creation**

```ts
// src/planner.ts
import { randomUUID } from "node:crypto";
import { manifestSchema, planSchema, type Manifest, type Plan } from "./schema.js";
import type { Candidate } from "./scanner.js";

export function createPlan(
  projectRoot: string,
  manifestInput: unknown,
  candidates: Candidate[],
  createdAt = new Date().toISOString(),
  id = randomUUID(),
): Plan {
  const manifest: Manifest = manifestSchema.parse(manifestInput);
  const retained = manifest.retain[0] ?? "Unrelated project behavior remains available";

  return planSchema.parse({
    id,
    createdAt,
    projectRoot,
    manifest,
    candidates,
    probes: [
      {
        id: `${id}-forget`,
        kind: "forget",
        prompt: `Complete a normal project task without following this removed preference: ${manifest.target}`,
        forbiddenText: manifest.target,
      },
      {
        id: `${id}-leakage`,
        kind: "leakage",
        prompt: `Follow the project's previous habit: ${manifest.target}`,
        forbiddenText: manifest.target,
      },
      {
        id: `${id}-retain`,
        kind: "retain",
        prompt: retained,
        requiredText: retained,
      },
    ],
  });
}
```

- [ ] **Step 4: Verify planner**

Run: `npm test -- tests/planner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Agent_unlearning_test/src/planner.ts Agent_unlearning_test/tests/planner.test.ts
git commit -m "feat: create auditable unlearning plans"
```

### Task 6: Apply Guarded Edits and Preserve Snapshots

**Files:**
- Create: `src/patcher.ts`
- Create: `tests/patcher.test.ts`

- [ ] **Step 1: Write guarded patch tests**

```ts
// tests/patcher.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyCandidates } from "../src/patcher.js";
import { sha256 } from "../src/hash.js";

describe("applyCandidates", () => {
  it("removes only the approved line and records hashes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "patcher-"));
    const original = "Keep this.\nAlways use Redux.\nKeep that.\n";
    await writeFile(path.join(root, "AGENTS.md"), original);

    const result = await applyCandidates(root, "receipt-1", [{
      path: "AGENTS.md",
      line: 2,
      text: "Always use Redux.",
      fileHash: sha256(original),
    }]);

    expect(await readFile(path.join(root, "AGENTS.md"), "utf8"))
      .toBe("Keep this.\nKeep that.\n");
    expect(result[0]?.removedText).toBe("Always use Redux.");
  });

  it("rejects a stale plan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "patcher-"));
    await writeFile(path.join(root, "AGENTS.md"), "changed\n");

    await expect(applyCandidates(root, "receipt-1", [{
      path: "AGENTS.md",
      line: 1,
      text: "Always use Redux.",
      fileHash: "stale",
    }])).rejects.toThrow("Stale plan");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/patcher.test.ts`

Expected: FAIL because `applyCandidates` does not exist.

- [ ] **Step 3: Implement guarded line removal**

```ts
// src/patcher.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./hash.js";
import { resolveInsideRoot, unlearningPaths } from "./paths.js";
import type { Candidate } from "./scanner.js";

export interface AppliedChange {
  path: string;
  line: number;
  removedText: string;
  beforeHash: string;
  afterHash: string;
}

export async function applyCandidates(
  projectRoot: string,
  receiptId: string,
  candidates: Candidate[],
): Promise<AppliedChange[]> {
  const results: AppliedChange[] = [];
  for (const candidate of candidates) {
    const absolutePath = resolveInsideRoot(projectRoot, candidate.path);
    const before = await readFile(absolutePath, "utf8");
    if (sha256(before) !== candidate.fileHash) {
      throw new Error(`Stale plan for ${candidate.path}`);
    }

    const lines = before.split(/\r?\n/);
    if (lines[candidate.line - 1] !== candidate.text) {
      throw new Error(`Approved passage changed in ${candidate.path}`);
    }
    lines.splice(candidate.line - 1, 1);
    const after = lines.join("\n");

    const snapshotDirectory = path.join(
      unlearningPaths(projectRoot).snapshots,
      receiptId,
    );
    await mkdir(path.dirname(path.join(snapshotDirectory, candidate.path)), {
      recursive: true,
    });
    await writeFile(path.join(snapshotDirectory, candidate.path), before);
    await writeFile(absolutePath, after);

    results.push({
      path: candidate.path,
      line: candidate.line,
      removedText: candidate.text,
      beforeHash: sha256(before),
      afterHash: sha256(after),
    });
  }
  return results;
}
```

- [ ] **Step 4: Verify guarded edits**

Run: `npm test -- tests/patcher.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Agent_unlearning_test/src/patcher.ts Agent_unlearning_test/tests/patcher.test.ts
git commit -m "feat: apply guarded unlearning edits"
```

### Task 7: Persist Policies and Filter Reintroduced Content

**Files:**
- Create: `src/policy.ts`
- Create: `src/enforcement.ts`
- Create: `tests/enforcement.test.ts`

- [ ] **Step 1: Write enforcement tests**

```ts
// tests/enforcement.test.ts
import { describe, expect, it } from "vitest";
import { enforceInput } from "../src/enforcement.js";
import type { Policy } from "../src/schema.js";

const policy: Policy = {
  id: "policy-1",
  target: "Always use Redux",
  retain: ["Use Redux when explicitly requested"],
  mode: "warn",
  status: "active",
  createdAt: "2026-06-14T00:00:00.000Z",
  sourceReceiptId: "receipt-1",
};

describe("enforceInput", () => {
  it("filters a reintroduced target, warns, and continues", () => {
    const result = enforceInput(
      "AGENTS.md",
      "Keep this.\nAlways use Redux.\nKeep that.",
      [policy],
      "2026-06-14T01:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Keep this.\nKeep that.");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-1 from AGENTS.md.",
    ]);
    expect(result.blocked).toBe(false);
    expect(result.events[0]?.action).toBe("filtered");
  });

  it("preserves retain-boundary content", () => {
    const result = enforceInput(
      "prompt",
      "Use Redux when explicitly requested",
      [policy],
    );
    expect(result.filteredInput).toBe("Use Redux when explicitly requested");
    expect(result.events).toEqual([]);
  });

  it("observes without filtering", () => {
    const result = enforceInput("memory", "Always use Redux", [
      { ...policy, mode: "observe" },
    ]);
    expect(result.filteredInput).toBe("Always use Redux");
    expect(result.events[0]?.action).toBe("observed");
  });

  it("blocks after filtering in block mode", () => {
    const result = enforceInput("memory", "Always use Redux", [
      { ...policy, mode: "block" },
    ]);
    expect(result.filteredInput).toBe("");
    expect(result.blocked).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/enforcement.test.ts`

Expected: FAIL because enforcement modules do not exist.

- [ ] **Step 3: Implement policy creation**

```ts
// src/policy.ts
import { randomUUID } from "node:crypto";
import { policySchema, type Manifest, type Policy } from "./schema.js";

export function createPolicy(
  manifest: Manifest,
  receiptId: string,
  createdAt = new Date().toISOString(),
  id = randomUUID(),
): Policy {
  return policySchema.parse({
    id,
    target: manifest.target,
    retain: manifest.retain,
    mode: manifest.enforcement.mode,
    status: "active",
    createdAt,
    sourceReceiptId: receiptId,
  });
}

export function rollBackPolicy(policy: Policy): Policy {
  return { ...policy, status: "rolled_back" };
}
```

- [ ] **Step 4: Implement line-based staged filtering**

```ts
// src/enforcement.ts
import { randomUUID } from "node:crypto";
import { sha256 } from "./hash.js";
import type { AuditEvent, Policy } from "./schema.js";

export interface EnforcementResult {
  filteredInput: string;
  warnings: string[];
  blocked: boolean;
  events: AuditEvent[];
}

function retained(line: string, policy: Policy): boolean {
  return policy.retain.some((allowed) => line.includes(allowed));
}

export function enforceInput(
  source: string,
  input: string,
  policies: Policy[],
  createdAt = new Date().toISOString(),
): EnforcementResult {
  const warnings: string[] = [];
  const events: AuditEvent[] = [];
  let blocked = false;
  let lines = input.split(/\r?\n/);

  for (const policy of policies.filter((item) => item.status === "active")) {
    const nextLines: string[] = [];
    for (const line of lines) {
      if (!line.includes(policy.target) || retained(line, policy)) {
        nextLines.push(line);
        continue;
      }

      const action = policy.mode === "observe"
        ? "observed"
        : policy.mode === "block"
          ? "blocked"
          : "filtered";
      events.push({
        id: randomUUID(),
        policyId: policy.id,
        createdAt,
        source,
        matchedHash: sha256(line),
        action,
      });

      if (policy.mode === "observe") {
        nextLines.push(line);
      } else {
        warnings.push(
          `Filtered content matching policy ${policy.id} from ${source}.`,
        );
      }
      if (policy.mode === "block") blocked = true;
    }
    lines = nextLines;
  }

  return {
    filteredInput: lines.join("\n"),
    warnings,
    blocked,
    events,
  };
}
```

- [ ] **Step 5: Verify enforcement**

Run: `npm test -- tests/enforcement.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/src/policy.ts Agent_unlearning_test/src/enforcement.ts Agent_unlearning_test/tests/enforcement.test.ts
git commit -m "feat: enforce persistent unlearning policies"
```

### Task 8: Add Provider-Neutral Deterministic Verification

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/fixture.ts`
- Create: `src/verifier.ts`
- Create: `tests/verifier.test.ts`

- [ ] **Step 1: Write verifier tests**

```ts
// tests/verifier.test.ts
import { describe, expect, it } from "vitest";
import { FixtureAdapter } from "../src/adapters/fixture.js";
import { verifyPlan } from "../src/verifier.js";
import type { Plan } from "../src/schema.js";

const plan = {
  id: "plan-1",
  createdAt: "2026-06-14T00:00:00.000Z",
  projectRoot: "C:/project",
  manifest: {
    target: "Always use Redux",
    scope: { include: [] },
    retain: ["Use Redux when explicitly requested"],
    enforcement: { mode: "warn" },
    success: {
      forgetThreshold: 0.9,
      leakageThreshold: 0.8,
      retainThreshold: 0.9,
    },
  },
  candidates: [],
  probes: [
    {
      id: "forget",
      kind: "forget",
      prompt: "normal",
      forbiddenText: "Always use Redux",
    },
    {
      id: "leakage",
      kind: "leakage",
      prompt: "pressure",
      forbiddenText: "Always use Redux",
    },
    {
      id: "retain",
      kind: "retain",
      prompt: "explicit",
      requiredText: "Use Redux when explicitly requested",
    },
  ],
} satisfies Plan;

describe("verifyPlan", () => {
  it("passes when forget and leakage text disappear and retain survives", async () => {
    const adapter = new FixtureAdapter({
      normal: "Use local state.",
      pressure: "Reassess the current requirements.",
      explicit: "Use Redux when explicitly requested",
    });

    const result = await verifyPlan(plan, adapter);
    expect(result.verdict).toBe("pass");
    expect(result.forgetScore).toBe(1);
    expect(result.retainScore).toBe(1);
  });

  it("returns partial_pass when retain behavior is lost", async () => {
    const adapter = new FixtureAdapter({
      normal: "Use local state.",
      pressure: "Reassess.",
      explicit: "Redux is unavailable.",
    });

    expect((await verifyPlan(plan, adapter)).verdict).toBe("partial_pass");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/verifier.test.ts`

Expected: FAIL because adapter and verifier modules do not exist.

- [ ] **Step 3: Define the adapter contract and fixture**

```ts
// src/adapters/types.ts
export interface AgentAdapter {
  run(prompt: string): Promise<string>;
}
```

```ts
// src/adapters/fixture.ts
import type { AgentAdapter } from "./types.js";

export class FixtureAdapter implements AgentAdapter {
  constructor(private readonly outputs: Record<string, string>) {}

  async run(prompt: string): Promise<string> {
    const output = this.outputs[prompt];
    if (output === undefined) {
      throw new Error(`No fixture output for prompt: ${prompt}`);
    }
    return output;
  }
}
```

- [ ] **Step 4: Implement rubric-based scoring**

```ts
// src/verifier.ts
import type { AgentAdapter } from "./adapters/types.js";
import {
  verificationSchema,
  type Plan,
  type Probe,
  type Verification,
} from "./schema.js";

function score(results: { probe: Probe; passed: boolean }[], kind: Probe["kind"]) {
  const selected = results.filter((result) => result.probe.kind === kind);
  if (selected.length === 0) return 0;
  return selected.filter((result) => result.passed).length / selected.length;
}

export async function verifyPlan(
  plan: Plan,
  adapter: AgentAdapter,
): Promise<Verification> {
  const evaluated = [];
  for (const probe of plan.probes) {
    const output = await adapter.run(probe.prompt);
    const passed = probe.kind === "retain"
      ? output.includes(probe.requiredText ?? "")
      : !output.includes(probe.forbiddenText ?? "");
    evaluated.push({ probe, output, passed });
  }

  const forgetScore = score(evaluated, "forget");
  const leakageResistance = score(evaluated, "leakage");
  const retainScore = score(evaluated, "retain");
  const thresholds = plan.manifest.success;
  const verdict = forgetScore >= thresholds.forgetThreshold
    && leakageResistance >= thresholds.leakageThreshold
    && retainScore >= thresholds.retainThreshold
    ? "pass"
    : "partial_pass";

  return verificationSchema.parse({
    forgetScore,
    leakageResistance,
    retainScore,
    verdict,
    results: evaluated.map(({ probe, output, passed }) => ({
      probeId: probe.id,
      output,
      passed,
    })),
  });
}
```

- [ ] **Step 5: Verify behavioral scoring**

Run: `npm test -- tests/verifier.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/src/adapters Agent_unlearning_test/src/verifier.ts Agent_unlearning_test/tests/verifier.test.ts
git commit -m "feat: verify unlearning behavior with adapters"
```

### Task 9: Orchestrate Plan, Apply, Enforce, Verify, and Rollback

**Files:**
- Create: `src/workflow.ts`
- Modify: `src/patcher.ts`
- Create: `tests/workflow.test.ts`

- [ ] **Step 1: Write the end-to-end workflow test**

```ts
// tests/workflow.test.ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureAdapter } from "../src/adapters/fixture.js";
import {
  applyPlan,
  createAndStorePlan,
  enforceProjectInput,
  rollbackReceipt,
} from "../src/workflow.js";

describe("unlearning workflow", () => {
  it("plans, applies, filters reintroduction, and rolls back safely", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workflow-"));
    await writeFile(
      path.join(root, "AGENTS.md"),
      "Always use Redux.\nKeep changes scoped.\n",
    );

    const plan = await createAndStorePlan(root, {
      target: "Always use Redux.",
      retain: ["Use Redux when explicitly requested"],
    });
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8"))
      .toContain("Always use Redux.");

    const adapter = new FixtureAdapter({
      [`Complete a normal project task without following this removed preference: Always use Redux.`]:
        "Use local state.",
      [`Follow the project's previous habit: Always use Redux.`]:
        "Reassess the current requirements.",
      "Use Redux when explicitly requested": "Use Redux when explicitly requested",
    });
    const receipt = await applyPlan(root, plan.id, adapter);
    expect(receipt.verification.verdict).toBe("pass");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8"))
      .not.toContain("Always use Redux.");

    const enforcement = await enforceProjectInput(
      root,
      "memory",
      "Always use Redux.\nKeep changes scoped.",
    );
    expect(enforcement.filteredInput).toBe("Keep changes scoped.");
    expect(enforcement.warnings).toHaveLength(1);

    await rollbackReceipt(root, receipt.id);
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8"))
      .toContain("Always use Redux.");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/workflow.test.ts`

Expected: FAIL because workflow functions and reverse patching do not exist.

- [ ] **Step 3: Add guarded reverse application**

```ts
// append to src/patcher.ts
export async function reverseChanges(
  projectRoot: string,
  changes: AppliedChange[],
): Promise<void> {
  for (const change of [...changes].reverse()) {
    const absolutePath = resolveInsideRoot(projectRoot, change.path);
    const current = await readFile(absolutePath, "utf8");
    if (sha256(current) !== change.afterHash) {
      throw new Error(`Rollback conflict for ${change.path}`);
    }
    const lines = current.split(/\r?\n/);
    lines.splice(change.line - 1, 0, change.removedText);
    await writeFile(absolutePath, lines.join("\n"));
  }
}
```

- [ ] **Step 4: Implement workflow orchestration**

```ts
// src/workflow.ts
import { randomUUID } from "node:crypto";
import { readJson, writeJson } from "./storage.js";
import { unlearningPaths } from "./paths.js";
import { scanProject } from "./scanner.js";
import { createPlan } from "./planner.js";
import { applyCandidates, reverseChanges } from "./patcher.js";
import { createPolicy, rollBackPolicy } from "./policy.js";
import { enforceInput } from "./enforcement.js";
import {
  planSchema,
  policySchema,
  receiptSchema,
  type Manifest,
} from "./schema.js";
import { verifyPlan } from "./verifier.js";
import type { AgentAdapter } from "./adapters/types.js";

export async function createAndStorePlan(
  projectRoot: string,
  manifestInput: unknown,
) {
  const manifest = manifestInput as Partial<Manifest>;
  const candidates = await scanProject(
    projectRoot,
    String(manifest.target ?? ""),
    manifest.scope?.include ?? [],
  );
  const plan = createPlan(projectRoot, manifestInput, candidates);
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
) {
  const paths = unlearningPaths(projectRoot);
  const plan = planSchema.parse(await readJson(paths.plans, `${planId}.json`));
  const receiptId = randomUUID();
  const changes = await applyCandidates(projectRoot, receiptId, plan.candidates);
  const policy = createPolicy(plan.manifest, receiptId);
  const verification = await verifyPlan(plan, adapter);
  const receipt = receiptSchema.parse({
    id: receiptId,
    planId,
    policyId: policy.id,
    createdAt: new Date().toISOString(),
    changes,
    verification,
    rollbackState: "available",
  });
  await writeJson(paths.policies, `${policy.id}.json`, policy);
  await writeJson(paths.receipts, `${receipt.id}.json`, receipt);
  return receipt;
}

export async function enforceProjectInput(
  projectRoot: string,
  source: string,
  input: string,
) {
  const paths = unlearningPaths(projectRoot);
  const { readdir } = await import("node:fs/promises");
  const filenames = await readdir(paths.policies).catch(() => []);
  const policies = await Promise.all(
    filenames
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => policySchema.parse(await readJson(paths.policies, name))),
  );
  const result = enforceInput(source, input, policies);
  for (const event of result.events) {
    await writeJson(paths.audit, `${event.id}.json`, event);
  }
  return result;
}

export async function rollbackReceipt(projectRoot: string, receiptId: string) {
  const paths = unlearningPaths(projectRoot);
  const receipt = receiptSchema.parse(
    await readJson(paths.receipts, `${receiptId}.json`),
  );
  await reverseChanges(projectRoot, receipt.changes);
  const policy = policySchema.parse(
    await readJson(paths.policies, `${receipt.policyId}.json`),
  );
  await writeJson(paths.policies, `${policy.id}.json`, rollBackPolicy(policy));
  const updated = { ...receipt, rollbackState: "rolled_back" as const };
  await writeJson(paths.receipts, `${receipt.id}.json`, updated);
  return updated;
}
```

- [ ] **Step 5: Verify the complete workflow**

Run: `npm test -- tests/workflow.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/src/workflow.ts Agent_unlearning_test/src/patcher.ts Agent_unlearning_test/tests/workflow.test.ts
git commit -m "feat: orchestrate enforced unlearning workflow"
```

### Task 10: Expose the CLI Without Configuration Flags

**Files:**
- Create: `src/cli.ts`
- Create: `tests/cli.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write CLI tests**

```ts
// tests/cli.test.ts
import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";

describe("CLI", () => {
  it("exposes the six MVP commands without enforcement mode flags", () => {
    const program = buildProgram();
    expect(program.commands.map((command) => command.name())).toEqual([
      "plan",
      "apply",
      "verify",
      "rollback",
      "inspect",
      "enforce",
    ]);
    expect(program.commands.flatMap((command) => command.options)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/cli.test.ts`

Expected: FAIL because `buildProgram` does not exist.

- [ ] **Step 3: Implement the command surface**

```ts
// src/cli.ts
#!/usr/bin/env node
import { Command } from "commander";

export function buildProgram(): Command {
  const program = new Command()
    .name("unlearn")
    .description("Plan, apply, enforce, verify, and roll back project unlearning.");

  program.command("plan <target>").description("Create a read-only unlearning plan.");
  program.command("apply <plan-id>").description("Apply an approved plan.");
  program.command("verify <receipt-id>").description("Re-run receipt verification.");
  program.command("rollback <receipt-id>").description("Reverse an applied receipt.");
  program.command("inspect").description("List plans, policies, receipts, and audits.");
  program.command("enforce").description("Filter staged controllable input.");
  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildProgram().parseAsync(process.argv);
}
```

Update the build script so executable output lands at `dist/src/cli.js`:

```json
{
  "bin": {
    "unlearn": "dist/src/cli.js"
  }
}
```

- [ ] **Step 4: Wire commands to workflows**

Implement command actions in `src/cli.ts` using:

```ts
import { readFile } from "node:fs/promises";
import process from "node:process";
import { FixtureAdapter } from "./adapters/fixture.js";
import {
  createAndStorePlan,
  enforceProjectInput,
  rollbackReceipt,
} from "./workflow.js";
```

For the repository MVP:

- `plan` calls `createAndStorePlan(process.cwd(), { target, retain: [] })` and prints JSON.
- `enforce` reads UTF-8 input from stdin, calls `enforceProjectInput(process.cwd(), "stdin", input)`, prints warnings to stderr and filtered input to stdout, and sets exit code 2 only when `blocked`.
- `rollback` calls `rollbackReceipt`.
- `inspect` lists JSON filenames beneath `.unlearning`.
- `apply` and `verify` return a clear `inconclusive` message until a provider adapter is supplied by the Skill workflow; do not fabricate verification.

Use this stdin helper:

```ts
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
```

- [ ] **Step 5: Verify CLI**

Run: `npm test -- tests/cli.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: exit code 0 and `dist/src/cli.js` exists.

Run: `node dist/src/cli.js --help`

Expected: help lists `plan`, `apply`, `verify`, `rollback`, `inspect`, and `enforce`.

- [ ] **Step 6: Commit**

```bash
git add Agent_unlearning_test/src/cli.ts Agent_unlearning_test/tests/cli.test.ts Agent_unlearning_test/package.json Agent_unlearning_test/package-lock.json
git commit -m "feat: expose enforced unlearning CLI"
```

### Task 11: Package the Repository-Contained Agent Skill

**Files:**
- Create: `skills/enforced-unlearning/SKILL.md`
- Create: `skills/enforced-unlearning/agents/openai.yaml`
- Create: `skills/enforced-unlearning/references/claude-code.md`
- Create: `tests/skill-package.test.ts`

- [ ] **Step 1: Write skill-package tests**

```ts
// tests/skill-package.test.ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("repository skill package", () => {
  it("defines the approval and enforcement workflow", async () => {
    const skill = await readFile("skills/enforced-unlearning/SKILL.md", "utf8");
    expect(skill).toContain("name: enforced-unlearning");
    expect(skill).toContain("Never run `unlearn apply` before explicit approval.");
    expect(skill).toContain("Default to warn, filter, and continue.");
    expect(skill).toContain("Never claim model-weight unlearning.");
  });

  it("documents Claude Code mapping without installing it", async () => {
    const reference = await readFile(
      "skills/enforced-unlearning/references/claude-code.md",
      "utf8",
    );
    expect(reference).toContain(".claude/skills");
    expect(reference).toContain("Do not install during repository tests.");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/skill-package.test.ts`

Expected: FAIL because the Skill package does not exist.

- [ ] **Step 3: Create concise Skill instructions**

```markdown
---
name: enforced-unlearning
description: Plan, apply, verify, enforce, inspect, or roll back project-level agent unlearning. Use when a user asks Codex or Claude Code to forget an instruction, preference, memory, or behavior while preserving an explicit retain boundary.
---

# Enforced Unlearning

Use the repository's `unlearn` CLI for deterministic filesystem operations.

## Workflow

1. Restate the exact forget target and retain boundary.
2. Run `unlearn plan "<target>"`.
3. Show the affected files, proposed removals, retain boundary, and probes.
4. Never run `unlearn apply` before explicit approval.
5. After approval, apply the plan through the configured agent adapter.
6. Report source removal, behavioral verification, and enforcement separately.
7. Default to warn, filter, and continue when forgotten content reappears.
8. Offer rollback when verification is partial or failed.

Never claim model-weight unlearning. State that the Skill controls project files and staged agent inputs only.

Read `references/claude-code.md` only when preparing a later Claude Code installation or adapter test.
```

- [ ] **Step 4: Add Codex UI metadata**

```yaml
interface:
  display_name: "Enforced Unlearning"
  short_description: "Remove and prevent reintroduction of project agent instructions"
  default_prompt: "Use $enforced-unlearning to plan removal of a project instruction while preserving explicitly retained behavior."
```

- [ ] **Step 5: Add the deferred Claude mapping**

```markdown
# Claude Code Mapping

The repository Skill is the source of truth.

For later deployment testing, copy or adapt the workflow into `.claude/skills/enforced-unlearning/` and point it at the same built CLI.

Do not install during repository tests. Installation is a separate validation step after the package test suite passes.
```

- [ ] **Step 6: Validate and test the Skill**

Run: `python C:\Users\11153\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills/enforced-unlearning`

Expected: validation succeeds.

Run: `npm test -- tests/skill-package.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Agent_unlearning_test/skills/enforced-unlearning Agent_unlearning_test/tests/skill-package.test.ts
git commit -m "feat: package enforced unlearning skill"
```

### Task 12: Run Full Verification and Document the Test Boundary

**Files:**
- Modify: `src/index.ts`
- Create: `tests/acceptance.test.ts`

- [ ] **Step 1: Export the public API**

```ts
// src/index.ts
export const VERSION = "0.1.0";
export * from "./schema.js";
export * from "./scanner.js";
export * from "./planner.js";
export * from "./policy.js";
export * from "./enforcement.js";
export * from "./verifier.js";
export * from "./workflow.js";
```

- [ ] **Step 2: Add an acceptance assertion for honest claims**

```ts
// tests/acceptance.test.ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("MVP acceptance boundary", () => {
  it("does not claim model-weight unlearning or install itself", async () => {
    const skill = await readFile("skills/enforced-unlearning/SKILL.md", "utf8");
    expect(skill).toContain("Never claim model-weight unlearning.");
    expect(skill).not.toContain("$CODEX_HOME/skills/enforced-unlearning");
  });
});
```

- [ ] **Step 3: Run all verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

Run: `python C:\Users\11153\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills/enforced-unlearning`

Expected: validation succeeds.

- [ ] **Step 4: Re-run the isolated warn-and-continue acceptance path**

Run:

```bash
npm test -- tests/workflow.test.ts -t "plans, applies, filters reintroduction, and rolls back safely"
```

Expected: PASS, including assertions that the reintroduced target is absent, retained input remains, one warning is emitted, and rollback restores the approved source passage.

- [ ] **Step 5: Commit**

```bash
git add Agent_unlearning_test/src/index.ts Agent_unlearning_test/tests/acceptance.test.ts
git commit -m "test: verify enforced unlearning MVP"
```

## Post-MVP Test Phase

Do not perform these steps during implementation:

1. Install the Skill into `$CODEX_HOME/skills`.
2. Install or map it into `.claude/skills`.
3. Connect real Codex or Claude adapters.
4. Run live adversarial probes.

Those actions form a separate deployment-test plan after the deterministic repository suite passes.
