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
  const retained =
    manifest.retain.length > 0
      ? manifest.retain
      : ["Unrelated project behavior remains available"];

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
      ...retained.map((retainText, index) => ({
        id: index === 0 ? `${id}-retain` : `${id}-retain-${index + 1}`,
        kind: "retain" as const,
        prompt: retainText,
        requiredText: retainText,
      })),
    ],
  });
}
