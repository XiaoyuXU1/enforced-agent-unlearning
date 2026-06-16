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
      [
        {
          path: "AGENTS.md",
          line: 3,
          text: "Always use Redux.",
          fileHash: "abc",
        },
      ],
      "2026-06-14T00:00:00.000Z",
      "plan-1",
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

  it("creates one retain probe per retain boundary in order", () => {
    const plan = createPlan(
      "C:/project",
      {
        target: "Always use Redux",
        retain: [
          "Use Redux when explicitly requested",
          "Keep reducers pure",
        ],
      },
      [],
      "2026-06-14T00:00:00.000Z",
      "plan-1",
    );

    expect(plan.probes.map((probe) => probe.kind)).toEqual([
      "forget",
      "leakage",
      "retain",
      "retain",
    ]);
    expect(plan.probes.slice(2).map((probe) => probe.prompt)).toEqual([
      "Use Redux when explicitly requested",
      "Keep reducers pure",
    ]);
    expect(plan.probes.slice(2).map((probe) => probe.requiredText)).toEqual([
      "Use Redux when explicitly requested",
      "Keep reducers pure",
    ]);
    expect(plan.probes.map((probe) => probe.id)).toEqual([
      "plan-1-forget",
      "plan-1-leakage",
      "plan-1-retain",
      "plan-1-retain-2",
    ]);
  });

  it("creates a fallback retain probe when the retain list is empty", () => {
    const plan = createPlan(
      "C:/project",
      {
        target: "Always use Redux",
        retain: [],
      },
      [],
      "2026-06-14T00:00:00.000Z",
      "plan-1",
    );

    expect(plan.probes.map((probe) => probe.id)).toEqual([
      "plan-1-forget",
      "plan-1-leakage",
      "plan-1-retain",
    ]);
    expect(plan.probes[2]).toMatchObject({
      id: "plan-1-retain",
      kind: "retain",
      prompt: "Unrelated project behavior remains available",
      requiredText: "Unrelated project behavior remains available",
    });
  });
});
