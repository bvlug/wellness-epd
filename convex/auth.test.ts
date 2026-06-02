import type { UserIdentity } from "convex/server";
import { describe, expect, it } from "vitest";
import { type AuthContext, UnauthenticatedError, requireIdentity } from "./auth";

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
