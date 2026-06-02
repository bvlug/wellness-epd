import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { type AuditMutationContext, auditArgsValidators, logAudit } from "./audit";
import { UnauthenticatedError } from "./auth";

/**
 * Offline unit tests for the append-only audit writer (Story F-4-S1; FR-20,
 * BR-13, AC-7, AC-9). They exercise {@link logAudit} against a fake
 * insert-only `db`, so they assert real behavior without a Convex runtime (the
 * live deploy is verified manually — see the PR). No patient-identifying data
 * appears anywhere here: all values are synthetic system ids / enums (AC-9,
 * BR-10).
 */

/** Synthetic Clerk identity — fake subject + role claim, no real PII. */
function identity(roles?: unknown): UserIdentity {
  const base = {
    subject: "user_synthetic_0001",
    issuer: "https://example.clerk.accounts.dev",
    tokenIdentifier: "https://example.clerk.accounts.dev|user_synthetic_0001",
    // A name is present on the identity on purpose: the writer must NOT copy it
    // into the audit entry (AC-9). It is filler the writer is required to ignore.
    name: "Test Clinician",
  };
  return (roles === undefined ? base : { ...base, roles }) as unknown as UserIdentity;
}

/**
 * Records every document inserted, so a test can assert exactly one row was
 * written and inspect its fields. `failOnInsert` simulates the audit table
 * being unavailable (BR-13 rollback scenario).
 */
function fakeCtx(options: {
  identity?: UserIdentity | null;
  failOnInsert?: boolean;
}): { ctx: AuditMutationContext; inserts: Array<{ table: string; document: unknown }> } {
  const inserts: Array<{ table: string; document: unknown }> = [];
  const ctx: AuditMutationContext = {
    auth: {
      getUserIdentity: () =>
        Promise.resolve(options.identity === undefined ? identity() : options.identity),
    },
    db: {
      insert: (table, document) => {
        if (options.failOnInsert) {
          return Promise.reject(new Error("simulated audit_log unavailable"));
        }
        inserts.push({ table, document });
        return Promise.resolve("audit_row_id" as GenericId<string>);
      },
    },
  };
  return { ctx, inserts };
}

const PATIENT_RESOURCE_ID = "patient_synthetic_0001";

describe("logAudit — writes one append-only entry (FR-20)", () => {
  it("writes exactly one audit_log entry on a patient create (AC-9)", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity(["balie"]) });

    await logAudit(ctx, {
      action: "create",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("audit_log");
    expect(inserts[0].document).toMatchObject({
      action: "create",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
      actorId: "user_synthetic_0001",
      actorRole: "balie",
    });
  });

  it("writes an audit_log entry with action=view on a patient view (AC-7)", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity(["behandelaar"]) });

    await logAudit(ctx, {
      action: "view",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].document).toMatchObject({
      action: "view",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
    });
  });
});

describe("logAudit — entry is PII-free (AC-9)", () => {
  it("stores exactly the six PII-free fields and nothing else", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity(["admin"]) });

    await logAudit(ctx, {
      action: "create",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
    });

    expect(Object.keys(inserts[0].document as object).sort()).toEqual(
      ["action", "actorId", "actorRole", "resourceId", "resourceType", "timestamp"].sort(),
    );
  });

  it("never copies the identity display name (or any free text) into the entry", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity(["balie"]) });

    await logAudit(ctx, {
      action: "create",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
    });

    const serialized = JSON.stringify(inserts[0].document);
    // The synthetic identity carries name "Test Clinician"; it must not leak.
    expect(serialized).not.toContain("Test Clinician");
    expect(serialized).not.toContain("Clinician");
  });

  it("records actorId/actorRole from the identity, never from caller arguments", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity(["behandelaar"]) });

    // Attempt to smuggle actor fields via args. The narrow LogAuditArgs type
    // has no such fields, so we cast to prove the runtime ignores them too.
    await logAudit(ctx, {
      action: "view",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
      actorId: "user_attacker",
      actorRole: "admin",
    } as unknown as Parameters<typeof logAudit>[1]);

    expect(inserts[0].document).toMatchObject({
      actorId: "user_synthetic_0001",
      actorRole: "behandelaar",
    });
  });

  it("derives a deterministic, sorted actorRole for a multi-role caller", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity(["behandelaar", "admin"]) });

    await logAudit(ctx, {
      action: "edit",
      resourceType: "behandeling",
      resourceId: "behandeling_synthetic_0001",
    });

    expect((inserts[0].document as { actorRole: string }).actorRole).toBe("admin,behandelaar");
  });

  it("records a 'unknown' actorRole sentinel when no recognized role is held", async () => {
    const { ctx, inserts } = fakeCtx({ identity: identity() });

    await logAudit(ctx, {
      action: "create",
      resourceType: "patient",
      resourceId: PATIENT_RESOURCE_ID,
    });

    expect((inserts[0].document as { actorRole: string }).actorRole).toBe("unknown");
  });

  it("uses the deterministic mutation clock for the timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T10:00:00.000Z"));
    try {
      const { ctx, inserts } = fakeCtx({ identity: identity(["balie"]) });
      await logAudit(ctx, {
        action: "create",
        resourceType: "patient",
        resourceId: PATIENT_RESOURCE_ID,
      });
      expect((inserts[0].document as { timestamp: number }).timestamp).toBe(
        Date.parse("2026-06-02T10:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("logAudit — transactional rollback (BR-13)", () => {
  it("propagates (does not swallow) a failed audit insert so the parent mutation aborts", async () => {
    const { ctx } = fakeCtx({ identity: identity(["balie"]), failOnInsert: true });

    await expect(
      logAudit(ctx, {
        action: "create",
        resourceType: "patient",
        resourceId: PATIENT_RESOURCE_ID,
      }),
    ).rejects.toThrowError(/simulated audit_log unavailable/);
  });

  it("propagates an UnauthenticatedError and writes nothing when there is no identity", async () => {
    const { ctx, inserts } = fakeCtx({ identity: null });

    await expect(
      logAudit(ctx, {
        action: "create",
        resourceType: "patient",
        resourceId: PATIENT_RESOURCE_ID,
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(inserts).toHaveLength(0);
  });
});

describe("audit writer is append-only / insert-only (BR-13)", () => {
  const auditSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "audit.ts"),
    "utf8",
  );

  it("contains no patch/replace/delete call (authoritative insert-only enforcement)", () => {
    expect(/\.(patch|replace|delete)\s*\(/.test(auditSource)).toBe(false);
  });

  it("performs a database write only via ctx.db.insert", () => {
    const dbCalls = auditSource.match(/\bctx\.db\.\w+/g) ?? [];
    expect(dbCalls.length).toBeGreaterThan(0);
    for (const call of dbCalls) {
      expect(call).toBe("ctx.db.insert");
    }
  });

  it("exposes no update/delete method on its AuditMutationContext db handle", () => {
    // The context interface declares only `insert`; any patch/replace/delete
    // member would make the writer capable of a mutating call. Assert the type
    // surface stays insert-only by inspecting the declared db members.
    const dbBlock = auditSource.match(/db:\s*\{[\s\S]*?\};/)?.[0] ?? "";
    expect(dbBlock).toContain("insert:");
    expect(dbBlock).not.toMatch(/\b(patch|replace|delete)\s*:/);
  });
});

describe("auditArgsValidators expose the closed vocabularies (FR-20)", () => {
  it("validates action, resourceType, and resourceId", () => {
    expect(Object.keys(auditArgsValidators).sort()).toEqual(
      ["action", "resourceId", "resourceType"].sort(),
    );
  });
});
