import type { AgentAdapter } from "./adapters/types.js";
import {
  probeResultSchema,
  verificationSchema,
  type Plan,
  type Probe,
  type Verification,
} from "./schema.js";

type EvaluatedProbe = {
  probe: Probe;
  output: string;
  passed: boolean;
};

type ProbeResult = ReturnType<typeof probeResultSchema.parse>;

function score(results: EvaluatedProbe[], kind: Probe["kind"]): number {
  const selected = results.filter((result) => result.probe.kind === kind);
  if (selected.length === 0) {
    return 0;
  }
  return (
    selected.filter((result) => result.passed).length / selected.length
  );
}

function hasContent(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getRequiredText(probe: Probe): string {
  if (!hasContent(probe.requiredText)) {
    throw new Error(`Retain probe ${probe.id} is missing requiredText`);
  }
  return probe.requiredText;
}

function getForbiddenText(probe: Probe): string {
  if (!hasContent(probe.forbiddenText)) {
    throw new Error(`Probe ${probe.id} is missing forbiddenText`);
  }
  return probe.forbiddenText;
}

function assertProbeReady(probe: Probe): void {
  if (probe.kind === "retain") {
    getRequiredText(probe);
  } else {
    getForbiddenText(probe);
  }
}

function baselinePassed(probe: Probe, output: string): boolean {
  if (probe.kind === "retain") {
    return output.includes(getRequiredText(probe));
  }
  return output.includes(getForbiddenText(probe));
}

function patchedPassed(
  probe: Probe,
  output: string,
  baselineResult: ProbeResult,
): boolean {
  if (!baselineResult.passed) {
    return false;
  }
  if (probe.kind === "retain") {
    return output.includes(getRequiredText(probe));
  }
  return !output.includes(getForbiddenText(probe));
}

function assertProbesReady(plan: Plan): void {
  for (const probe of plan.probes) {
    assertProbeReady(probe);
  }
}

export async function captureBaseline(
  plan: Plan,
  adapter: AgentAdapter,
): Promise<ProbeResult[]> {
  assertProbesReady(plan);
  const results: ProbeResult[] = [];

  for (const probe of plan.probes) {
    try {
      const output = await adapter.run(probe.prompt, "baseline");
      results.push(
        probeResultSchema.parse({
          probeId: probe.id,
          output,
          passed: baselinePassed(probe, output),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Baseline adapter error for ${probe.id}: ${message}`);
    }
  }

  return results;
}

export async function verifyPlan(
  plan: Plan,
  adapter: AgentAdapter,
  baselineResults: ProbeResult[],
): Promise<Verification> {
  const results: EvaluatedProbe[] = [];
  let adapterError = false;

  assertProbesReady(plan);
  if (baselineResults.length !== plan.probes.length) {
    throw new Error("Baseline results do not match plan probes");
  }

  for (const [index, probe] of plan.probes.entries()) {
    const baselineResult = baselineResults[index];
    if (!baselineResult || baselineResult.probeId !== probe.id) {
      throw new Error("Baseline results do not match plan probes");
    }
    try {
      const output = await adapter.run(probe.prompt, "patched");
      const passed = patchedPassed(probe, output, baselineResult);

      results.push({ probe, output, passed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        probe,
        output: `Adapter error: ${message}`,
        passed: false,
      });
      adapterError = true;
      break;
    }
  }

  const forgetScore = score(results, "forget");
  const leakageResistance = score(results, "leakage");
  const retainScore = score(results, "retain");
  const thresholds = plan.manifest.success;
  const allPass =
    forgetScore >= thresholds.forgetThreshold &&
    leakageResistance >= thresholds.leakageThreshold &&
    retainScore >= thresholds.retainThreshold;
  const improvedTargetBehavior = results.some(
    (result) => result.probe.kind !== "retain" && result.passed,
  );

  return verificationSchema.parse({
    baselineResults,
    forgetScore,
    leakageResistance,
    retainScore,
    verdict: adapterError
      ? "inconclusive"
      : !improvedTargetBehavior
        ? "fail"
        : allPass
          ? "pass"
          : "partial_pass",
    results: results.map(({ probe, output, passed }) => ({
      probeId: probe.id,
      output,
      passed,
    })),
  });
}
