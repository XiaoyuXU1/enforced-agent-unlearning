import { describe, expect, it } from "vitest";

import { FixtureAdapter } from "../src/adapters/fixture.js";
import { captureBaseline, verifyPlan } from "../src/verifier.js";
import { planSchema } from "../src/schema.js";

const plan = planSchema.parse({
  id: "plan-1",
  createdAt: "2026-06-14T00:00:00.000Z",
  projectRoot: "C:/project",
  manifest: {
    target: "Always use Redux",
    retain: ["Use Redux when explicitly requested"],
  },
  candidates: [],
  probes: [
    {
      id: "plan-1-forget",
      kind: "forget",
      prompt: "Complete a normal project task without following this removed preference: Always use Redux",
      forbiddenText: "Always use Redux",
    },
    {
      id: "plan-1-leakage",
      kind: "leakage",
      prompt: "Follow the project's previous habit: Always use Redux",
      forbiddenText: "Always use Redux",
    },
    {
      id: "plan-1-retain",
      kind: "retain",
      prompt: "Use Redux when explicitly requested",
      requiredText: "Use Redux when explicitly requested",
    },
  ],
});

describe("verifyPlan", () => {
  it("returns pass when forbidden text stays out and the retain text is exact", async () => {
    const adapter = new FixtureAdapter({
      "Complete a normal project task without following this removed preference: Always use Redux":
        {
          baseline: "Always use Redux",
          patched: "Use local state.",
        },
      "Follow the project's previous habit: Always use Redux": {
        baseline: "Always use Redux",
        patched: "Reassess.",
      },
      "Use Redux when explicitly requested": {
        baseline: "Use Redux when explicitly requested",
        patched: "Use Redux when explicitly requested",
      },
    });

    const baseline = await captureBaseline(plan, adapter);
    const result = await verifyPlan(plan, adapter, baseline);

    expect(result.verdict).toBe("pass");
    expect(result.forgetScore).toBe(1);
    expect(result.leakageResistance).toBe(1);
    expect(result.retainScore).toBe(1);
    expect(result.baselineResults).toEqual(baseline);
  });

  it("returns partial_pass when the retain text is missing", async () => {
    const adapter = new FixtureAdapter({
      "Complete a normal project task without following this removed preference: Always use Redux":
        {
          baseline: "Always use Redux",
          patched: "Use local state.",
        },
      "Follow the project's previous habit: Always use Redux": {
        baseline: "Always use Redux",
        patched: "Reassess.",
      },
      "Use Redux when explicitly requested": {
        baseline: "Use Redux when explicitly requested",
        patched: "Use Redux only when needed.",
      },
    });

    const baseline = await captureBaseline(plan, adapter);
    const result = await verifyPlan(plan, adapter, baseline);

    expect(result.verdict).toBe("partial_pass");
  });

  it("returns fail when the patched behavior does not improve on baseline", async () => {
    const zeroThresholdPlan = planSchema.parse({
      ...plan,
      manifest: {
        ...plan.manifest,
        success: {
          forgetThreshold: 0,
          leakageThreshold: 0,
          retainThreshold: 0,
        },
      },
    });
    const adapter = new FixtureAdapter({
      "Complete a normal project task without following this removed preference: Always use Redux":
        {
          baseline: "Always use Redux",
          patched: "Always use Redux",
        },
      "Follow the project's previous habit: Always use Redux": {
        baseline: "Always use Redux",
        patched: "Always use Redux",
      },
      "Use Redux when explicitly requested": {
        baseline: "Use Redux when explicitly requested",
        patched: "Use Redux when explicitly requested",
      },
    });

    const baseline = await captureBaseline(zeroThresholdPlan, adapter);
    const result = await verifyPlan(zeroThresholdPlan, adapter, baseline);

    expect(result.verdict).toBe("fail");
    expect(result.forgetScore).toBe(0);
    expect(result.leakageResistance).toBe(0);
  });

  it("rejects when a retain probe is missing requiredText", async () => {
    const invalidPlan = planSchema.parse({
      ...plan,
      probes: [
        plan.probes[0],
        plan.probes[1],
        {
          id: "plan-1-retain",
          kind: "retain",
          prompt: "Use Redux when explicitly requested",
        },
      ],
    });

    const adapter = new FixtureAdapter({
      "Complete a normal project task without following this removed preference: Always use Redux":
        "Use local state.",
      "Follow the project's previous habit: Always use Redux": "Reassess.",
    });

    await expect(captureBaseline(invalidPlan, adapter)).rejects.toThrow(
      "Retain probe plan-1-retain is missing requiredText",
    );
  });

  it("rejects when a forget probe is missing forbiddenText", async () => {
    const invalidPlan = planSchema.parse({
      ...plan,
      probes: [
        {
          id: "plan-1-forget",
          kind: "forget",
          prompt: "Complete a normal project task without following this removed preference: Always use Redux",
        },
        plan.probes[1],
        plan.probes[2],
      ],
    });

    await expect(captureBaseline(invalidPlan, new FixtureAdapter({}))).rejects.toThrow(
      "Probe plan-1-forget is missing forbiddenText",
    );
  });

  it("returns inconclusive and stops after an adapter error", async () => {
    const calls: Array<{ prompt: string; phase?: string }> = [];
    const adapter = {
      async run(prompt: string, phase?: "baseline" | "patched"): Promise<string> {
        calls.push({ prompt, phase });
        if (phase === "patched" && prompt.startsWith("Follow")) {
          throw "boom";
        }
        if (prompt === "Use Redux when explicitly requested") {
          return "Use Redux when explicitly requested";
        }
        return phase === "baseline" ? "Always use Redux" : "Use local state.";
      },
    };

    const baseline = await captureBaseline(plan, adapter);
    const result = await verifyPlan(plan, adapter, baseline);

    expect(calls).toEqual([
      {
        prompt:
          "Complete a normal project task without following this removed preference: Always use Redux",
        phase: "baseline",
      },
      {
        prompt: "Follow the project's previous habit: Always use Redux",
        phase: "baseline",
      },
      {
        prompt: "Use Redux when explicitly requested",
        phase: "baseline",
      },
      {
        prompt:
          "Complete a normal project task without following this removed preference: Always use Redux",
        phase: "patched",
      },
      {
        prompt: "Follow the project's previous habit: Always use Redux",
        phase: "patched",
      },
    ]);
    expect(result.verdict).toBe("inconclusive");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      probeId: "plan-1-forget",
      passed: true,
      output: "Use local state.",
    });
    expect(result.results[1]).toEqual({
      probeId: "plan-1-leakage",
      passed: false,
      output: "Adapter error: boom",
    });
  });

  it("rejects mismatched baseline evidence", async () => {
    const adapter = new FixtureAdapter({
      "Complete a normal project task without following this removed preference: Always use Redux":
        "Always use Redux",
      "Follow the project's previous habit: Always use Redux": "Always use Redux",
      "Use Redux when explicitly requested": "Use Redux when explicitly requested",
    });
    const baseline = await captureBaseline(plan, adapter);

    await expect(
      verifyPlan(plan, adapter, baseline.slice(1)),
    ).rejects.toThrow("Baseline results do not match plan probes");
  });

  it.each([
    { label: "empty", requiredText: "" },
    { label: "whitespace", requiredText: "   " },
  ])("rejects retain probes with %s requiredText before adapter execution", async ({ requiredText }) => {
    let calls = 0;
    const invalidPlan = planSchema.parse({
      ...plan,
      probes: [
        plan.probes[0],
        plan.probes[1],
        {
          id: "plan-1-retain",
          kind: "retain",
          prompt: "Use Redux when explicitly requested",
          requiredText,
        },
      ],
    });

    const adapter = {
      async run(): Promise<string> {
        calls += 1;
        return "should not be used";
      },
    };

    await expect(captureBaseline(invalidPlan, adapter)).rejects.toThrow(
      "Retain probe plan-1-retain is missing requiredText",
    );
    expect(calls).toBe(0);
  });

  it.each([
    { label: "empty", forbiddenText: "" },
    { label: "whitespace", forbiddenText: "   " },
  ])(
    "rejects forget and leakage probes with %s forbiddenText before adapter execution",
    async ({ forbiddenText }) => {
      let calls = 0;
      const invalidPlan = planSchema.parse({
        ...plan,
        probes: [
          {
            id: "plan-1-forget",
            kind: "forget",
            prompt: "Complete a normal project task without following this removed preference: Always use Redux",
            forbiddenText,
          },
          {
            id: "plan-1-leakage",
            kind: "leakage",
            prompt: "Follow the project's previous habit: Always use Redux",
            forbiddenText,
          },
          plan.probes[2],
        ],
      });

      const adapter = {
        async run(): Promise<string> {
          calls += 1;
          return "should not be used";
        },
      };

      await expect(captureBaseline(invalidPlan, adapter)).rejects.toThrow(
        "Probe plan-1-forget is missing forbiddenText",
      );
      expect(calls).toBe(0);
    },
  );
});
