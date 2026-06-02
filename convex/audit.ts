import type { GenericId } from "convex/values";
import { v } from "convex/values";
import { type AuthContext, getRoles, requireIdentity } from "./auth";
import { AUDIT_ACTION_VALUES, AUDIT_RESOURCE_TYPE_VALUES } from "./schema";

/**
 * Append-only audit-log writer (Story F-4-S1; FR-20, BR-13, AC-7, AC-9).
 *
 * This module is the SINGLE place in the Convex backend that names the
 * `audit_log` table. Every domain mutation that creates, edits, views, or
 * finalizes patient / behandeling data calls {@link logAudit} instead of
 * touching the table directly. Two invariants follow from that encapsulation:
 *
 *  1. **Append-only (BR-13).** This module only ever calls `ctx.db.insert`.
 *     There is no `patch` / `replace` / `delete` path here, and because domain
 *     code never names `audit_log`, the schema-test tripwire
 *     (`convex/schema.test.ts`) can statically guarantee no Convex source that
 *     references `audit_log` performs a mutating write. Insert-only enforcement
 *     is authoritative here (#17): see `convex/audit.test.ts`.
 *
 *  2. **PII-free (AC-9).** An audit entry must never carry patient-identifying
 *     data. The writer makes that structurally hard: callers may pass ONLY an
 *     enum `action`, an enum `resourceType`, and an opaque `resourceId` (a
 *     Convex document id — a system identifier, not a human-readable value).
 *     The actor's identity (`actorId`) and role (`actorRole`) are derived from
 *     the authenticated Clerk identity inside this function — never from
 *     caller-supplied arguments — so a caller cannot smuggle a display name or
 *     other free text into the log. Each stored field is justified below.
 */

/** The one place the audit table name is spelled out. */
const AUDIT_TABLE = "audit_log" as const;

/** Audit action literal — mirrors the schema's controlled vocabulary (FR-20). */
export type AuditAction = (typeof AUDIT_ACTION_VALUES)[number];

/** Audit resource-type literal — mirrors the schema's vocabulary (FR-20). */
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPE_VALUES)[number];

/**
 * The minimal mutation context {@link logAudit} depends on: the auth slice (to
 * resolve the actor) plus an insert-only database handle. Declaring it locally
 * — rather than importing a full Convex `MutationCtx` — keeps the writer
 * unit-testable without a Convex runtime, and deliberately exposes NO
 * `patch` / `replace` / `delete`, so this module is structurally insert-only.
 */
export interface AuditMutationContext extends AuthContext {
  db: {
    insert: (table: typeof AUDIT_TABLE, document: AuditDocument) => Promise<GenericId<string>>;
  };
}

/**
 * The exact, PII-free shape persisted to `audit_log`. Every field is a system
 * identifier, an enum, or a timestamp — none is free text or human-readable
 * personal data (AC-9):
 *
 *  - `actorId`     Clerk subject id (opaque `user_...` token), not a name.
 *  - `actorRole`   one of the closed {@link AuthContext} roles vocabulary.
 *  - `action`      closed enum (create/edit/view/deactivate/finalize).
 *  - `resourceType`closed enum (patient/afspraak/behandeling/behandelsoort).
 *  - `resourceId`  opaque Convex document id of the affected record.
 *  - `timestamp`   epoch millis from the deterministic mutation clock.
 */
interface AuditDocument {
  actorId: string;
  actorRole: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  timestamp: number;
}

/**
 * Arguments a caller may supply to {@link logAudit}. Intentionally narrow: only
 * the two enums and an opaque resource id. There is deliberately NO field for a
 * name, note, BSN, email, address, or behandelverslag — the type makes it
 * impossible to pass PII into the log (AC-9). `actorId` / `actorRole` are NOT
 * accepted here; they are derived from the Clerk identity inside the writer.
 */
export interface LogAuditArgs {
  action: AuditAction;
  resourceType: AuditResourceType;
  /** Opaque Convex document id of the affected record (a system id, not PII). */
  resourceId: string;
}

/**
 * Reusable Convex `v.*` validators for the audit arguments, so domain mutations
 * that accept these can validate them at the boundary with the same closed
 * vocabularies the schema uses. Exposed as a convenience; the TypeScript
 * {@link LogAuditArgs} type is the structural guarantee.
 */
export const auditArgsValidators = {
  action: v.union(...AUDIT_ACTION_VALUES.map((value) => v.literal(value))),
  resourceType: v.union(...AUDIT_RESOURCE_TYPE_VALUES.map((value) => v.literal(value))),
  resourceId: v.string(),
} as const;

/**
 * Collapse the caller's held roles into a single, PII-free `actorRole` string.
 *
 * Roles are a closed, non-personal vocabulary (`balie` / `behandelaar` /
 * `admin`), so storing them never risks PII. A caller may hold several roles;
 * we record them deterministically (sorted, comma-joined) so the same caller
 * always yields the same value. A caller with no recognized role is recorded as
 * the sentinel `"unknown"` rather than an empty string — the audit entry is
 * still written (accountability must not depend on a correctly configured role
 * claim), but the gap is visible.
 */
function deriveActorRole(roles: readonly string[]): string {
  if (roles.length === 0) {
    return "unknown";
  }
  return [...roles].sort().join(",");
}

/**
 * Write exactly one append-only `audit_log` entry for an authorized operation.
 *
 * Resolves the actor from the authenticated Clerk identity (throwing
 * {@link import("./auth").UnauthenticatedError} via {@link requireIdentity} if
 * there is none), derives a PII-free `actorRole`, and inserts a single row.
 *
 * **Transactional guarantee (BR-13).** This performs a `ctx.db.insert` inside
 * the caller's Convex mutation. If the insert (or the identity resolution)
 * fails, the error propagates: Convex runs each mutation as a single
 * transaction, so the parent mutation — including the primary record it was
 * writing — is rolled back as a unit. Callers MUST NOT swallow this error.
 *
 * @returns the id of the inserted audit_log row.
 */
export async function logAudit(
  ctx: AuditMutationContext,
  args: LogAuditArgs,
): Promise<GenericId<string>> {
  const identity = await requireIdentity(ctx);
  const document: AuditDocument = {
    actorId: identity.subject,
    actorRole: deriveActorRole(getRoles(identity)),
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    timestamp: Date.now(),
  };
  return ctx.db.insert(AUDIT_TABLE, document);
}
