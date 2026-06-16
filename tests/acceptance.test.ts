import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";

const skillPath = path.resolve(
  import.meta.dirname,
  "../skills/enforced-unlearning/SKILL.md",
);

describe("Task 12 acceptance", () => {
  it("exports the public API surface", () => {
    expect(api.manifestSchema).toBeDefined();
    expect(api.scanProject).toBeDefined();
    expect(api.createPlan).toBeDefined();
    expect(api.createPolicy).toBeDefined();
    expect(api.enforceInput).toBeDefined();
    expect(api.verifyPlan).toBeDefined();
    expect(api.createAndStorePlan).toBeDefined();
  });

  it("keeps the enforced-unlearning skill package guarantees", async () => {
    const skill = await readFile(skillPath, "utf8");

    expect(skill).toContain("Never claim model-weight unlearning.");
    expect(skill).not.toContain("$CODEX_HOME/skills/enforced-unlearning");
    expect(skill).toContain('`unlearn plan "<target>"`');
    expect(skill).toContain("If retain boundaries are provided");
    expect(skill).toContain(
      "If no provider adapter is configured, `unlearn apply` and `unlearn verify` return `inconclusive` without claiming success.",
    );
    expect(skill).toContain(
      "Default to warn, filter, and continue when forgotten content reappears.",
    );
  });
});
