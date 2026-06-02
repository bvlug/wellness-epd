import { describe, expect, it } from "vitest";
import { isRole, parseRoles, withRole, withoutRole } from "./userRoles";

/**
 * Unit coverage for the pure role-set helpers. All fixtures are synthetic role
 * strings — there is no patient- or user-identifying data here (AVG/GDPR
 * mindset). The network layer in users.ts is intentionally not exercised over
 * the wire; the interesting logic (parse / add / remove, normalization,
 * fail-safe handling of junk) lives in these pure functions.
 */

describe("isRole", () => {
  it("accepts the three known roles", () => {
    expect(isRole("balie")).toBe(true);
    expect(isRole("behandelaar")).toBe(true);
    expect(isRole("admin")).toBe(true);
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isRole("superuser")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(["admin"])).toBe(false);
  });
});

describe("parseRoles (reads roles from raw Clerk public_metadata)", () => {
  it("returns the recognized roles present in the array", () => {
    expect(parseRoles(["balie", "behandelaar"])).toEqual(["balie", "behandelaar"]);
  });

  it("returns an empty array for a missing / non-array value", () => {
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles("balie")).toEqual([]);
    expect(parseRoles({ roles: ["balie"] })).toEqual([]);
  });

  it("drops unknown / malformed entries so junk metadata cannot smuggle roles", () => {
    expect(parseRoles(["balie", "superuser", 42, null, "admin"])).toEqual(["balie", "admin"]);
  });

  it("deduplicates and orders by the canonical ROLES order", () => {
    expect(parseRoles(["admin", "balie", "admin", "behandelaar"])).toEqual([
      "balie",
      "behandelaar",
      "admin",
    ]);
  });
});

describe("withRole (assign a role, additive union semantics)", () => {
  it("adds a role to a user that has none", () => {
    expect(withRole([], "behandelaar")).toEqual(["behandelaar"]);
  });

  it("adds a role alongside existing roles, in canonical order", () => {
    expect(withRole(["admin"], "balie")).toEqual(["balie", "admin"]);
  });

  it("is idempotent: adding an already-held role does not duplicate it", () => {
    expect(withRole(["balie"], "balie")).toEqual(["balie"]);
  });

  it("does not mutate the input array", () => {
    const current: ReturnType<typeof parseRoles> = ["balie"];
    withRole(current, "admin");
    expect(current).toEqual(["balie"]);
  });
});

describe("withoutRole (remove a role)", () => {
  it("removes a held role", () => {
    expect(withoutRole(["balie", "behandelaar"], "balie")).toEqual(["behandelaar"]);
  });

  it("is idempotent: removing a role the user lacks is a no-op", () => {
    expect(withoutRole(["balie"], "admin")).toEqual(["balie"]);
  });

  it("can empty the role set entirely", () => {
    expect(withoutRole(["admin"], "admin")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const current: ReturnType<typeof parseRoles> = ["balie", "admin"];
    withoutRole(current, "balie");
    expect(current).toEqual(["balie", "admin"]);
  });
});

describe("assign / remove round-trip", () => {
  it("returns to the original set after add then remove", () => {
    const start = parseRoles(["balie"]);
    const added = withRole(start, "behandelaar");
    expect(added).toEqual(["balie", "behandelaar"]);
    expect(withoutRole(added, "behandelaar")).toEqual(["balie"]);
  });
});
