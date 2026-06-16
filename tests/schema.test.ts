import { describe, expect, it } from "vitest";

import {
  auditEventSchema,
  candidateSchema,
  enforcementModeSchema,
  manifestSchema,
  planSchema,
  policySchema,
  probeResultSchema,
  probeSchema,
  receiptSchema,
  verificationSchema,
  verdictSchema,
} from "../src/schema.js";

describe("schema validation", () => {
  it("uses manifest defaults for mode and thresholds", () => {
    const parsed = manifestSchema.parse({ target: "  example  " });

    expect(parsed.target).toBe("example");
    expect(parsed.enforcement.mode).toBe("warn");
    expect(parsed.success).toEqual({
      forgetThreshold: 0.9,
      leakageThreshold: 0.8,
      retainThreshold: 0.9,
    });
  });

  it("rejects a blank manifest target", () => {
    expect(() => manifestSchema.parse({ target: "   " })).toThrow();
  });

  it("rejects an out-of-range threshold", () => {
    expect(() =>
      manifestSchema.parse({
        target: "example",
        success: {
          forgetThreshold: 1.1,
        },
      }),
    ).toThrow();
  });

  it("keeps the enforcement mode enum narrow", () => {
    expect(enforcementModeSchema.options).toEqual(["observe", "warn", "block"]);
  });

  it("keeps the verdict enum narrow", () => {
    expect(verdictSchema.options).toEqual([
      "pass",
      "partial_pass",
      "fail",
      "inconclusive",
    ]);
  });

  it("validates the remaining domain schemas", () => {
    const candidate = candidateSchema.parse({
      fileHash: "abc123",
      line: 1,
      path: "src/file.ts",
      text: "content",
    });
    const probe = probeSchema.parse({
      id: "probe-1",
      kind: "forget",
      prompt: "remove this",
    });
    const plan = planSchema.parse({
      id: "plan-1",
      candidates: [candidate],
      createdAt: "2024-01-01T00:00:00.000Z",
      manifest: { target: "example" },
      probes: [probe],
      projectRoot: "C:/repo",
    });
    const policy = policySchema.parse({
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "policy-1",
      mode: "observe",
      retain: [],
      sourceReceiptId: "receipt-1",
      status: "active",
      target: "example",
    });
    const result = probeResultSchema.parse({
      output: "ok",
      passed: true,
      probeId: "probe-1",
    });
    const verification = verificationSchema.parse({
      baselineResults: [result],
      forgetScore: 1,
      leakageResistance: 0.5,
      retainScore: 0.9,
      results: [result],
      verdict: "pass",
    });
    const receipt = receiptSchema.parse({
      changes: [
        {
          afterHash: "b",
          beforeHash: "a",
          line: 1,
          path: "src/file.ts",
          removedText: "x",
        },
      ],
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "receipt-1",
      planId: plan.id,
      policyId: policy.id,
      rollbackState: "available",
      verification,
    });
    const audit = auditEventSchema.parse({
      action: "observed",
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "audit-1",
      matchedHash: "hash",
      policyId: policy.id,
      source: "source",
    });

    expect(receipt.verification.verdict).toBe("pass");
    expect(audit.action).toBe("observed");
  });

  it("requires baseline evidence on completed verification records", () => {
    expect(() =>
      verificationSchema.parse({
        forgetScore: 1,
        leakageResistance: 1,
        retainScore: 1,
        results: [
          {
            output: "ok",
            passed: true,
            probeId: "probe-1",
          },
        ],
        verdict: "pass",
      }),
    ).toThrow();

    expect(() =>
      verificationSchema.parse({
        baselineResults: [],
        forgetScore: 1,
        leakageResistance: 1,
        retainScore: 1,
        results: [],
        verdict: "pass",
      }),
    ).toThrow();

    expect(() =>
      verificationSchema.parse({
        baselineResults: [
          {
            output: "baseline",
            passed: true,
            probeId: "probe-1",
          },
        ],
        forgetScore: 1,
        leakageResistance: 1,
        retainScore: 1,
        results: [
          {
            output: "patched",
            passed: true,
            probeId: "probe-2",
          },
        ],
        verdict: "pass",
      }),
    ).toThrow();
  });
});
