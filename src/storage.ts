import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { resolveInsideRoot, unlearningPaths } from "./paths.js";

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJson(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableJson((value as Record<string, unknown>)[key])]),
    );
  }

  return value;
}

function validateJsonFilename(fileName: string): void {
  const segments = fileName.split(/[\\/]/);
  if (
    path.isAbsolute(fileName) ||
    segments.length !== 1 ||
    segments.some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("Invalid JSON filename");
  }
}

function validateReadPath(filePath: string): void {
  if (path.normalize(filePath) !== filePath) {
    throw new Error("Invalid JSON filename");
  }
}

export { resolveInsideRoot, unlearningPaths };

export async function writeJson(
  directory: string,
  fileName: string,
  value: unknown,
): Promise<string> {
  validateJsonFilename(fileName);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, fileName);
  const json = `${JSON.stringify(stableJson(value), null, 2)}\n`;
  const tempFile = path.join(directory, `.${fileName}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempFile, json, "utf8");
    await rename(tempFile, destination);
  } catch (error) {
    try {
      await unlink(tempFile);
    } catch {
      // best effort cleanup
    }
    throw error;
  }

  return destination;
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  validateReadPath(filePath);
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
