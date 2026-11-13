/**
 * Zod request schemas for the studio API routes (Batch C, C7).
 *
 * zod lives only in `packages/orchestrator`, so the schemas live here and
 * the web routes import them from `@vow/orchestrator`. `route-error.ts`
 * maps a thrown ZodError to 400 by structural check, so no `instanceof`
 * is needed across the package boundary.
 *
 * All schemas reject instead of coercing: `z.number()` (never `Number()`),
 * `z.boolean()` (never `Boolean()`), enums, and ranges. Defaults mirror
 * the values the routes previously applied with destructuring defaults.
 */
import { z } from 'zod';
import { isK8sLabel, isK8sObjectName } from './exec-argv.js';

/** DNS-1123 label (Kubernetes namespace / service names, <=63 chars). */
export const k8sLabelSchema = (what: string) =>
  z
    .string()
    .min(1, `${what} is required`)
    .refine((v) => isK8sLabel(v), {
      message: `${what} must be a valid DNS-1123 label (lowercase alphanumeric and '-', <=63 chars)`,
    });

/** DNS-1123 subdomain (Kubernetes object names such as Secrets, <=253 chars). */
export const k8sObjectNameSchema = (what: string) =>
  z
    .string()
    .min(1, `${what} is required`)
    .refine((v) => isK8sObjectName(v), {
      message: `${what} must be a valid DNS-1123 subdomain (lowercase alphanumeric, '-' and '.', <=253 chars)`,
    });

const nonEmptyString = (what: string) => z.string().min(1, `${what} is required`);

/** POST /api/dr — disaster-recovery drill. */
export const drDrillSchema = z.object({
  scenario: z
    .enum(['POSTGRES_VOLUME_CORRUPTION', 'NAMESPACE_ACCIDENTAL_DELETION', 'ETCD_SPLIT_BRAIN_EMULATION'])
    .optional()
    .default('POSTGRES_VOLUME_CORRUPTION'),
});

/** POST /api/drift — reconcile / reverse_commit branches (after the argo:sync gate). */
export const driftRemediateSchema = z.object({
  driftId: nonEmptyString('driftId'),
});

/** POST /api/ebpf — packet-drop inspection. */
export const ebpfInspectSchema = z.object({
  sourcePod: nonEmptyString('sourcePod'),
  targetPod: nonEmptyString('targetPod'),
  port: z.number().int().min(1).max(65535).optional().default(80),
});

/** POST /api/fleet — switch_context / broadcast, dispatched on `action`. */
export const fleetActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('switch_context'),
    clusterId: nonEmptyString('clusterId'),
  }),
  z.object({
    action: z.literal('broadcast'),
    appId: nonEmptyString('appId'),
    targetClusterIds: z
      .array(nonEmptyString('targetClusterIds entry'))
      .min(1, 'targetClusterIds must not be empty'),
  }),
]);

/** POST /api/guard — toggle branch (after the security:manage gate).
 * `enabled` defaults to false, preserving the old `Boolean(enabled)` behavior
 * for callers that omit it. */
export const guardToggleSchema = z.object({
  ruleId: nonEmptyString('ruleId'),
  enabled: z.boolean().optional().default(false),
});

/** POST /api/guard — manifest-evaluation branch (after the security:read gate). */
export const guardEvaluateSchema = z.object({
  yaml: nonEmptyString('yaml content'),
});

/** POST /api/keda — synthetic load. */
export const kedaLoadSchema = z.object({
  targetWorkload: nonEmptyString('targetWorkload').optional().default('nextcloud-worker'),
  virtualUsers: z.number().int().positive().optional().default(20),
  durationSeconds: z.number().int().min(5).max(60).optional().default(15),
  targetRps: z.number().int().positive().optional().default(250),
  pattern: z.enum(['SPIKE', 'RAMP', 'CONSTANT']).optional().default('SPIKE'),
});

/** POST /api/mesh — enforce strict mTLS. */
export const meshEnforceSchema = z.object({
  namespace: k8sLabelSchema('namespace'),
});

/** POST /api/migrate — lint branch (after the data:query gate). */
export const migrateLintSchema = z.object({
  sql: nonEmptyString('sql'),
});

/** POST /api/migrate — execute branch (after the data:migrate gate). */
export const migrateExecuteSchema = z.object({
  version: nonEmptyString('version'),
  sql: nonEmptyString('sql'),
});

/** POST /api/postmortem — generate a report. */
export const postmortemGenerateSchema = z.object({
  incidentTitle: nonEmptyString('incidentTitle')
    .optional()
    .default('Cascading Timeout on Authentication Subsystem'),
  affectedWorkloads: z
    .array(nonEmptyString('affectedWorkloads entry'))
    .min(1, 'affectedWorkloads must not be empty')
    .optional()
    .default(['keycloak-0', 'postgres-postgresql-0']),
  severity: z.enum(['SEV-1', 'SEV-2', 'SEV-3']).optional().default('SEV-2'),
});

/** POST /api/previews — create branch (after the apps:deploy gate; `cleanup` bypasses). */
export const previewsCreateSchema = z.object({
  prNumber: z.number().int().positive(),
  branch: nonEmptyString('branch'),
  appName: nonEmptyString('appName'),
  ttlMinutes: z.number().int().min(1).max(10080).optional().default(120),
});

/** PATCH /api/previews — extend TTL. */
export const previewsExtendSchema = z.object({
  id: nonEmptyString('id'),
  additionalMinutes: z.number().int().min(1).max(10080).optional().default(60),
});

/** POST /api/rewind — compare / rewind branches (after the per-action gate). */
export const rewindActionSchema = z.object({
  snapshotId: nonEmptyString('snapshotId'),
});

/** POST /api/secretops — rotate / generate_sealed branches (after the secrets:manage gate). */
export const secretopsRotateSchema = z.object({
  secretName: k8sObjectNameSchema('secretName'),
  namespace: k8sLabelSchema('namespace'),
});

/** POST /api/secretops — generate_sealed branch. keyValues keeps its existing
 * manual non-empty-object check in the route (it is already strict); only
 * the names are schema-validated here. */
export const secretopsSealedSchema = z.object({
  secretName: k8sObjectNameSchema('secretName'),
  namespace: k8sLabelSchema('namespace'),
});

/** POST /api/slo — toggle_circuit_breaker branch. `tripped` must be a real
 * boolean; the old `Boolean(tripped)` coercion is gone. */
export const sloToggleSchema = z.object({
  serviceId: nonEmptyString('serviceId'),
  tripped: z.boolean(),
});

/** POST /api/wasm — deploy a Wasm microservice. */
export const wasmDeploySchema = z.object({
  serviceId: k8sLabelSchema('serviceId'),
  namespace: k8sLabelSchema('namespace').optional().default('default'),
});
