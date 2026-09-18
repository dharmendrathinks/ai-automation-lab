import { z } from 'zod';

export const triageDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  category: z.enum(['billing', 'account', 'technical', 'general', 'unknown']),
  intent: z.enum(['invoice_download', 'duplicate_charge', 'ambiguous_charge', 'account_mismatch', 'general_support', 'unknown']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  recommendedAction: z.enum(['reply', 'investigate_refund', 'clarify', 'escalate']),
  needsHumanReview: z.boolean(),
  ambiguity: z.enum(['clear', 'missing_information', 'conflicting_information']),
  evidenceRefs: z.array(z.string()).max(10),
  unresolvedIssues: z.array(z.string()).max(10),
  reason: z.string().min(1).max(500),
});
export type TriageDecision = z.infer<typeof triageDecisionSchema>;
