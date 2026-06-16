import { z } from "zod";

export const enforcementModeSchema = z.enum(["observe", "warn", "block"]);
export const verdictSchema = z.enum(["pass", "partial_pass", "fail", "inconclusive"]);

export const manifestSchema = z.object({
  target: z.string().trim().min(1),
  scope: z
    .object({
      include: z.array(z.string().trim().min(1)).default([]),
    })
    .default({ include: [] }),
  retain: z.array(z.string().trim().min(1)).default([]),
  enforcement: z
    .object({
      mode: enforcementModeSchema.default("warn"),
    })
    .default({ mode: "warn" }),
  success: z
    .object({
      forgetThreshold: z.number().min(0).max(1).default(0.9),
      leakageThreshold: z.number().min(0).max(1).default(0.8),
      retainThreshold: z.number().min(0).max(1).default(0.9),
    })
    .default({
      forgetThreshold: 0.9,
      leakageThreshold: 0.8,
      retainThreshold: 0.9,
    }),
});

export const candidateSchema = z.object({
  path: z.string().trim().min(1),
  line: z.number().int().positive(),
  text: z.string(),
  fileHash: z.string().trim().min(1),
});

export const probeSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["forget", "leakage", "retain"]),
  prompt: z.string().trim().min(1),
  forbiddenText: z.string().optional(),
  requiredText: z.string().optional(),
});

export const planSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  projectRoot: z.string().trim().min(1),
  manifest: manifestSchema,
  candidates: z.array(candidateSchema),
  probes: z.array(probeSchema),
});

export const policySchema = z.object({
  id: z.string().trim().min(1),
  target: z.string().trim().min(1),
  retain: z.array(z.string().trim().min(1)),
  mode: enforcementModeSchema,
  status: z.enum(["active", "disabled", "rolled_back"]),
  createdAt: z.string().trim().min(1),
  sourceReceiptId: z.string().trim().min(1),
});

export const probeResultSchema = z.object({
  probeId: z.string().trim().min(1),
  passed: z.boolean(),
  output: z.string(),
});

export const verificationSchema = z
  .object({
    baselineResults: z.array(probeResultSchema),
    forgetScore: z.number().min(0).max(1),
    leakageResistance: z.number().min(0).max(1),
    retainScore: z.number().min(0).max(1),
    verdict: verdictSchema,
    results: z.array(probeResultSchema),
  })
  .superRefine((verification, context) => {
    if (verification.verdict === "inconclusive") {
      return;
    }

    if (
      verification.baselineResults.length === 0 ||
      verification.baselineResults.length !== verification.results.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed verification requires matching baseline evidence",
        path: ["baselineResults"],
      });
      return;
    }

    verification.results.forEach((result, index) => {
      if (verification.baselineResults[index]?.probeId !== result.probeId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Completed verification baseline probe IDs must match results",
          path: ["baselineResults", index, "probeId"],
        });
      }
    });
  });

export const receiptSchema = z.object({
  id: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  policyId: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  changes: z.array(
    z.object({
      path: z.string().trim().min(1),
      beforeHash: z.string().trim().min(1),
      afterHash: z.string().trim().min(1),
      removedText: z.string(),
      line: z.number().int().positive(),
    }),
  ),
  verification: verificationSchema,
  rollbackState: z.enum(["available", "rolled_back", "conflict"]),
});

export const auditEventSchema = z.object({
  id: z.string().trim().min(1),
  policyId: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  source: z.string().trim().min(1),
  matchedHash: z.string().trim().min(1),
  action: z.enum(["observed", "filtered", "blocked"]),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Policy = z.infer<typeof policySchema>;
export type Probe = z.infer<typeof probeSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
