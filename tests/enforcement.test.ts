import { describe, expect, it } from "vitest";

import { sha256 } from "../src/hash.js";
import { enforceInput } from "../src/enforcement.js";
import { createPolicy, rollBackPolicy } from "../src/policy.js";
import { manifestSchema, policySchema } from "../src/schema.js";

const manifest = manifestSchema.parse({
  target: "Always use Redux.",
  retain: ["Use Redux when explicitly requested"],
  enforcement: { mode: "warn" },
});

const policyFixture = policySchema.parse({
  createdAt: "2026-06-14T00:00:00.000Z",
  id: "policy-1",
  mode: "warn",
  retain: ["Use Redux when explicitly requested"],
  sourceReceiptId: "receipt-1",
  status: "active",
  target: "Always use Redux.",
});

describe("policy helpers", () => {
  it("creates a parsed active policy from a manifest", () => {
    const policy = createPolicy(
      manifest,
      "receipt-1",
      "2026-06-14T00:00:00.000Z",
      "policy-1",
    );

    expect(policy).toEqual(policyFixture);
  });

  it("marks a policy rolled back", () => {
    expect(rollBackPolicy(policyFixture).status).toBe("rolled_back");
  });
});

describe("enforceInput", () => {
  it("warns on input and filters target text", () => {
    const result = enforceInput(
      "stdin",
      "Keep this.\nAlways use Redux.\nKeep that.",
      [policyFixture],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Keep this.\nKeep that.");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-1 from stdin.",
    ]);
    expect(result.blocked).toBe(false);
    expect(result.events).toEqual([
      {
        action: "filtered",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256("Always use Redux."),
        policyId: "policy-1",
        source: "stdin",
      },
    ]);
  });

  it("reports the input source in the warning", () => {
    const result = enforceInput(
      "memory",
      "Keep this.\nAlways use Redux.\nKeep that.",
      [policyFixture],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-1 from memory.",
    ]);
  });

  it("preserves CRLF input and trailing newline", () => {
    const result = enforceInput(
      "stdin",
      "Keep this.\r\nAlways use Redux.\r\nKeep that.\r\n",
      [policyFixture],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Keep this.\r\nKeep that.\r\n");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-1 from stdin.",
    ]);
  });

  it("processes active policies in policy order and ignores rolled back policies", () => {
    const policyA = policySchema.parse({
      ...policyFixture,
      id: "policy-A",
      target: "Alpha target.",
    });
    const policyB = policySchema.parse({
      ...policyFixture,
      id: "policy-B",
      target: "Beta target.",
    });
    const rolledBack = policySchema.parse({
      ...policyFixture,
      id: "policy-old",
      status: "rolled_back",
      target: "Legacy target.",
    });

    const result = enforceInput(
      "stdin",
      "Beta target.\nAlpha target.",
      [policyA, policyB, rolledBack],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-A from stdin.",
      "Filtered content matching policy policy-B from stdin.",
    ]);
    expect(result.events).toEqual([
      {
        action: "filtered",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256("Alpha target."),
        policyId: "policy-A",
        source: "stdin",
      },
      {
        action: "filtered",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256("Beta target."),
        policyId: "policy-B",
        source: "stdin",
      },
    ]);
  });

  it("ignores rolled back policy matches", () => {
    const rolledBack = policySchema.parse({
      ...policyFixture,
      id: "policy-old",
      status: "rolled_back",
      target: "Legacy target.",
    });

    const result = enforceInput(
      "stdin",
      "Legacy target.",
      [rolledBack],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Legacy target.");
    expect(result.warnings).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it("preserves retain-boundary text and emits no events", () => {
    const result = enforceInput("stdin", "Use Redux when explicitly requested", [
      policyFixture,
    ]);

    expect(result.filteredInput).toBe("Use Redux when explicitly requested");
    expect(result.warnings).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(result.events).toEqual([]);
  });

  it("warn mode removes target substrings from a mixed target and retain line", () => {
    const mixedLine =
      "Always use Redux. Use Redux when explicitly requested";
    const result = enforceInput(
      "stdin",
      mixedLine,
      [policyFixture],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Use Redux when explicitly requested");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-1 from stdin.",
    ]);
    expect(result.blocked).toBe(false);
    expect(result.events).toEqual([
      {
        action: "filtered",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256(mixedLine),
        policyId: "policy-1",
        source: "stdin",
      },
    ]);
  });

  it("still drops a target-only line", () => {
    const result = enforceInput(
      "stdin",
      "Always use Redux.",
      [policyFixture],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-1 from stdin.",
    ]);
    expect(result.blocked).toBe(false);
    expect(result.events).toEqual([
      {
        action: "filtered",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256("Always use Redux."),
        policyId: "policy-1",
        source: "stdin",
      },
    ]);
  });

  it("observes matching input without warning or filtering", () => {
    const observePolicy = policySchema.parse({
      ...policyFixture,
      id: "policy-observe",
      mode: "observe",
    });

    const result = enforceInput(
      "stdin",
      "Always use Redux.",
      [observePolicy],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Always use Redux.");
    expect(result.warnings).toEqual([]);
    expect(result.blocked).toBe(false);
    expect(result.events).toEqual([
      {
        action: "observed",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256("Always use Redux."),
        policyId: "policy-observe",
        source: "stdin",
      },
    ]);
  });

  it("blocks matching input", () => {
    const blockPolicy = policySchema.parse({
      ...policyFixture,
      id: "policy-block",
      mode: "block",
    });

    const result = enforceInput(
      "stdin",
      "Always use Redux.",
      [blockPolicy],
    );

    expect(result.filteredInput).toBe("");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-block from stdin.",
    ]);
    expect(result.blocked).toBe(true);
    expect(result.events).toEqual([
      {
        action: "blocked",
        createdAt: expect.any(String),
        id: expect.any(String),
        matchedHash: sha256("Always use Redux."),
        policyId: "policy-block",
        source: "stdin",
      },
    ]);
  });

  it("block mode removes target substrings from a mixed target and retain line", () => {
    const blockPolicy = policySchema.parse({
      ...policyFixture,
      id: "policy-block",
      mode: "block",
    });
    const mixedLine =
      "Always use Redux. Use Redux when explicitly requested";
    const result = enforceInput(
      "stdin",
      mixedLine,
      [blockPolicy],
      "2026-06-14T00:00:00.000Z",
    );

    expect(result.filteredInput).toBe("Use Redux when explicitly requested");
    expect(result.warnings).toEqual([
      "Filtered content matching policy policy-block from stdin.",
    ]);
    expect(result.blocked).toBe(true);
    expect(result.events).toEqual([
      {
        action: "blocked",
        createdAt: "2026-06-14T00:00:00.000Z",
        id: expect.any(String),
        matchedHash: sha256(mixedLine),
        policyId: "policy-block",
        source: "stdin",
      },
    ]);
  });
});
