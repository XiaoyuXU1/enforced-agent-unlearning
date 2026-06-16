import { randomUUID } from "node:crypto";

import { sha256 } from "./hash.js";
import { type AuditEvent, type Policy } from "./schema.js";

export type EnforcementResult = {
  blocked: boolean;
  events: AuditEvent[];
  filteredInput: string;
  warnings: string[];
};

export function retained(line: string, policy: Policy): boolean {
  return policy.retain.some((retainText) => line.includes(retainText));
}

function matches(line: string, policy: Policy): boolean {
  return line.includes(policy.target);
}

function removeTargetText(line: string, policy: Policy): string {
  return line.split(policy.target).join("").trim();
}

function warningFor(policy: Policy, source: string): string {
  return `Filtered content matching policy ${policy.id} from ${source}.`;
}

function createEvent(
  source: string,
  policy: Policy,
  line: string,
  action: AuditEvent["action"],
  createdAt: string,
): AuditEvent {
  return {
    action,
    createdAt,
    id: randomUUID(),
    matchedHash: sha256(line),
    policyId: policy.id,
    source,
  };
}

export function enforceInput(
  source: string,
  input: string,
  policies: Policy[],
  createdAt = new Date().toISOString(),
): EnforcementResult {
  const originalNewline = input.includes("\r\n") ? "\r\n" : "\n";
  let lines = input.split(/\r?\n/);
  const warnings: string[] = [];
  const events: AuditEvent[] = [];
  let blocked = false;

  for (const policy of policies) {
    if (policy.status !== "active") {
      continue;
    }

    const nextLines: string[] = [];

    for (const line of lines) {
      const hasRetain = retained(line, policy);
      if (!matches(line, policy)) {
        nextLines.push(line);
        continue;
      }

      const action =
        policy.mode === "observe"
          ? "observed"
          : policy.mode === "warn"
            ? "filtered"
            : "blocked";
      events.push(createEvent(source, policy, line, action, createdAt));

      if (policy.mode === "observe") {
        nextLines.push(line);
        continue;
      }

      warnings.push(warningFor(policy, source));
      if (policy.mode === "block") {
        blocked = true;
      }

      if (hasRetain) {
        const preservedLine = removeTargetText(line, policy);
        if (preservedLine.length > 0) {
          nextLines.push(preservedLine);
        }
      }
    }

    lines = nextLines;
  }

  return {
    blocked,
    events,
    filteredInput: lines.join(originalNewline),
    warnings,
  };
}
