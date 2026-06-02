import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  type AuthContext,
  PermissionDeniedError,
  type Role,
  UnauthenticatedError,
  assertHasRole,
  getRoles,
  requireIdentity,
} from "./auth";

/**
 * Synthetic identity — no real patient-identifying data (AVG/GDPR mindset).
 * `subject` mimics a Clerk user id shape; the rest is filler the guard ignores.
 */
const syntheticIdentity = {
  subject: "user_synthetic_0001",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "https://example.clerk.accounts.dev|user_synthetic_0001",
  name: "Test Clinician",
} as unknown as UserIdentity;

function ctxWithIdentity(identity: UserIdentity | null): AuthContext {
  return {
    auth: {
      getUserIdentity: () => Promise.resolve(identity),
    },
  };
}

/**
 * Builds a synthetic Clerk identity carrying the given `roles` claim. Uses only
 * fake subject/role values — no real names, BSN, or emails (AVG/GDPR mindset).
 */
function identityWithRoles(roles: unknown): UserIdentity {
  return {
    ...syntheticIdentity,
    roles,
  } as unknown as UserIdentity;
}

describe("requireIdentity (Convex authorization guard, EH-7)", () => {
  it("returns the identity when a valid Clerk identity is present", async () => {
    const identity = await requireIdentity(ctxWithIdentity(syntheticIdentity));
    expect(identity.subject).toBe("user_synthetic_0001");
  });

  it("throws UnauthenticatedError when there is no identity", async () => {
    await expect(requireIdentity(ctxWithIdentity(null))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("fails closed without leaking caller- or data-specific detail in the error", async () => {
    await expect(requireIdentity(ctxWithIdentity(null))).rejects.toThrowError(
      /valid Clerk identity is required/i,
    );
  });
});

describe("getRoles (reads recognized roles from the Clerk claim)", () => {
  it("returns the recognized roles present on the claim", () => {
    expect(getRoles(identityWithRoles(["balie", "behandelaar"]))).toEqual(["balie", "behandelaar"]);
  });

  it("returns an empty array when the claim is missing", () => {
    expect(getRoles(syntheticIdentity)).toEqual([]);
  });

  it("ignores unknown / malformed entries so a tampered token cannot smuggle roles", () => {
    expect(getRoles(identityWithRoles(["balie", "superuser", 42, null]))).toEqual(["balie"]);
  });

  it("treats a non-array claim as no roles", () => {
    expect(getRoles(identityWithRoles("balie"))).toEqual([]);
  });
});

describe("assertHasRole (role-based authorization, additive union semantics)", () => {
  it("passes when the caller holds the required role (AC-2 happy path)", async () => {
    const ctx = ctxWithIdentity(identityWithRoles(["balie"]));
    const identity = await assertHasRole(ctx, ["balie"]);
    expect(identity.subject).toBe("user_synthetic_0001");
  });

  it("throws a permission-denied ConvexError when the caller lacks the role (AC-2)", async () => {
    const ctx = ctxWithIdentity(identityWithRoles(["balie"]));
    await expect(assertHasRole(ctx, ["behandelaar"])).rejects.toBeInstanceOf(ConvexError);
    await expect(assertHasRole(ctx, ["behandelaar"])).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("denies with a detail-free payload naming only the requirement (AVG/GDPR)", async () => {
    const ctx = ctxWithIdentity(identityWithRoles(["balie"]));
    await expect(assertHasRole(ctx, ["behandelaar"])).rejects.toMatchObject({
      data: { code: "permission_denied", requiredAnyOf: ["behandelaar"] },
    });
  });

  it("passes a multi-role caller via the union of held roles (A-2)", async () => {
    const ctx = ctxWithIdentity(identityWithRoles(["behandelaar", "balie"]));
    await expect(assertHasRole(ctx, ["behandelaar"])).resolves.toMatchObject({
      subject: "user_synthetic_0001",
    });
  });

  it("passes when any one of several allowed roles is held", async () => {
    const ctx = ctxWithIdentity(identityWithRoles(["admin"]));
    const allowed: Role[] = ["behandelaar", "admin"];
    await expect(assertHasRole(ctx, allowed)).resolves.toMatchObject({
      subject: "user_synthetic_0001",
    });
  });

  it("rejects an unauthenticated caller before any role logic runs (AC-1)", async () => {
    await expect(assertHasRole(ctxWithIdentity(null), ["balie"])).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("denies an authenticated caller with no roles claim at all (fail closed)", async () => {
    const ctx = ctxWithIdentity(syntheticIdentity);
    await expect(assertHasRole(ctx, ["balie"])).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
