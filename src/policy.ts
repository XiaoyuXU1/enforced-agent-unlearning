import { randomUUID } from "node:crypto";

import { policySchema, type Manifest, type Policy } from "./schema.js";

export function createPolicy(
  manifest: Manifest,
  receiptId: string,
  createdAt = new Date().toISOString(),
  id = randomUUID(),
): Policy {
  return policySchema.parse({
    createdAt,
    id,
    mode: manifest.enforcement.mode,
    retain: manifest.retain,
    sourceReceiptId: receiptId,
    status: "active",
    target: manifest.target,
  });
}

export function rollBackPolicy(policy: Policy): Policy {
  return policySchema.parse({
    ...policy,
    status: "rolled_back",
  });
}
