#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";

import { VERSION } from "./index.js";
import { unlearningPaths } from "./paths.js";
import {
  createAndStorePlan,
  ensureSafeControlDirectories,
  enforceProjectInput,
  rollbackReceipt,
} from "./workflow.js";

type CliIo = {
  cwd?: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  setExitCode?: (code: number) => void;
};

type CliRuntime = {
  cwd: string;
  stdin: NodeJS.ReadableStream;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  setExitCode: (code: number) => void;
};

type CliDependencies = {
  createAndStorePlan: typeof createAndStorePlan;
  enforceProjectInput: typeof enforceProjectInput;
  rollbackReceipt: typeof rollbackReceipt;
};

function createRuntime(io: CliIo = {}): CliRuntime {
  return {
    cwd: io.cwd ?? process.cwd(),
    stdin: io.stdin ?? process.stdin,
    stdout: io.stdout ?? ((chunk) => process.stdout.write(chunk)),
    stderr: io.stderr ?? ((chunk) => process.stderr.write(chunk)),
    setExitCode: io.setExitCode ?? ((code) => {
      process.exitCode = code;
    }),
  };
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function setNonZeroExit(runtime: CliRuntime, code: number): void {
  runtime.setExitCode(code);
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function listJsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function inconclusiveMessage(
  action: "apply" | "verify",
  idKey: "planId" | "receiptId",
  idValue: string,
) {
  return {
    action,
    [idKey]: idValue,
    verdict: "inconclusive" as const,
    message:
      "A provider adapter is required to run this command. No project files were modified.",
  };
}

export function buildProgram(
  io: CliIo = {},
  dependencies: CliDependencies = {
    createAndStorePlan,
    enforceProjectInput,
    rollbackReceipt,
  },
): Command {
  const runtime = createRuntime(io);
  const program = new Command();

  program
    .name("unlearn")
    .version(VERSION)
    .configureOutput({
      writeOut: runtime.stdout,
      writeErr: runtime.stderr,
    });

  program
    .command("plan")
    .argument("<target>")
    .argument("[retain...]")
    .action(async (target: string, retain: string[]) => {
      const plan = await dependencies.createAndStorePlan(runtime.cwd, {
        target,
        retain,
      });
      runtime.stdout(formatJson(plan));
    });

  program
    .command("apply")
    .argument("<plan-id>")
    .action(async (planId: string) => {
      setNonZeroExit(runtime, 2);
      runtime.stdout(formatJson(inconclusiveMessage("apply", "planId", planId)));
    });

  program
    .command("verify")
    .argument("<receipt-id>")
    .action(async (receiptId: string) => {
      setNonZeroExit(runtime, 2);
      runtime.stdout(
        formatJson(inconclusiveMessage("verify", "receiptId", receiptId)),
      );
    });

  program
    .command("rollback")
    .argument("<receipt-id>")
    .action(async (receiptId: string) => {
      const receipt = await dependencies.rollbackReceipt(runtime.cwd, receiptId);
      runtime.stdout(formatJson(receipt));
    });

  program
    .command("inspect")
    .action(async () => {
      const paths = unlearningPaths(runtime.cwd);
      await ensureSafeControlDirectories(
        runtime.cwd,
        [paths.plans, paths.policies, paths.receipts, paths.audit],
        false,
      );
      const inspection = {
        plans: await listJsonFiles(paths.plans),
        policies: await listJsonFiles(paths.policies),
        receipts: await listJsonFiles(paths.receipts),
        audit: await listJsonFiles(paths.audit),
      };
      runtime.stdout(formatJson(inspection));
    });

  program
    .command("enforce")
    .action(async () => {
      const input = await readStdin(runtime.stdin);
      const result = await dependencies.enforceProjectInput(
        runtime.cwd,
        "stdin",
        input,
      );

      for (const warning of result.warnings) {
        runtime.stderr(`${warning}\n`);
      }

      runtime.stdout(result.filteredInput);
      if (result.blocked) {
        setNonZeroExit(runtime, 2);
      }
    });

  return program;
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  let exitCode = 0;
  const program = buildProgram({
    ...io,
    setExitCode: (code) => {
      exitCode = code;
      io.setExitCode?.(code);
    },
  });
  const runtime = createRuntime({
    ...io,
    setExitCode: (code) => {
      exitCode = code;
      io.setExitCode?.(code);
    },
  });
  program.exitOverride();

  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      runtime.setExitCode(error.exitCode);
      return error.exitCode;
    }
    throw error;
  }
}

function normalizeExecutablePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    return false;
  }

  return (
    normalizeExecutablePath(fileURLToPath(import.meta.url)) ===
    normalizeExecutablePath(invokedPath)
  );
}

if (isMainModule()) {
  void runCli(process.argv)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
