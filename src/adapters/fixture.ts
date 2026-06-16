import type { AdapterPhase, AgentAdapter } from "./types.js";

type FixtureOutput =
  | string
  | {
      baseline: string;
      patched: string;
    };

export class FixtureAdapter implements AgentAdapter {
  constructor(private readonly outputs: Record<string, FixtureOutput>) {}

  async run(prompt: string, phase: AdapterPhase = "patched"): Promise<string> {
    const output = this.outputs[prompt];
    if (output === undefined) {
      throw new Error(`No fixture output for prompt: ${prompt}`);
    }
    return typeof output === "string" ? output : output[phase];
  }
}
