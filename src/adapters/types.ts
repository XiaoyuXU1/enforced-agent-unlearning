export type AdapterPhase = "baseline" | "patched";

export interface AgentAdapter {
  run(prompt: string, phase?: AdapterPhase): Promise<string>;
}
