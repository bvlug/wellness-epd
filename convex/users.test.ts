import type { ClerkClient, User } from "@clerk/backend";
import type { UserIdentity } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { type AuthContext, PermissionDeniedError, UnauthenticatedError } from "./auth";
import {
  type Behandelaar,
  type BehandelaarCandidate,
  type ClerkClientFactory,
  type StaffUser,
  assignRoleHandler,
  listBehandelaarsHandler,
  listUsersHandler,
  removeRoleHandler,
  selectActiveBehandelaars,
} from "./users";

/**
 * Action-level coverage for the admin user/role management handlers in users.ts.
 *
 * The pure role-set math (parse / add / remove / normalize) is already covered
 * in userRoles.test.ts; this file exercises the THIN NETWORK LAYER: the
 * authorization boundary (AC-4), the read-modify-write against Clerk metadata
 * (AC-2/AC-3), the toStaffUser projection, and the pagination loop.
 *
 * All Clerk interaction is mocked — no network, no real secret. Every fixture is
 * synthetic STAFF data: fake Clerk user ids, role strings, and obviously-fake
 * names/emails. There is no patient-identifying data here (AVG/GDPR mindset).
 */

// ---------------------------------------------------------------------------
// Auth context fixtures (mirroring auth.test.ts)
// ---------------------------------------------------------------------------

const adminIdentity = {
  subject: "user_synthetic_admin",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "https://example.clerk.accounts.dev|user_synthetic_admin",
  roles: ["admin"],
} as unknown as UserIdentity;

const balieIdentity = {
  subject: "user_synthetic_balie",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "https://example.clerk.accounts.dev|user_synthetic_balie",
  roles: ["balie"],
} as unknown as UserIdentity;

function ctxWithIdentity(identity: UserIdentity | null): AuthContext {
  return {
    auth: {
      getUserIdentity: () => Promise.resolve(identity),
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Clerk client + spy factory
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic Clerk `User`-shaped object. Only the fields toStaffUser /
 * the handlers read are populated; everything else is irrelevant. Synthetic
 * staff data only.
 */
function fakeUser(overrides: {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  publicMetadata?: Record<string, unknown>;
}): User {
  const { id, firstName = null, lastName = null, email = null, publicMetadata = {} } = overrides;
  return {
    id,
    firstName,
    lastName,
    primaryEmailAddress: email === null ? null : { emailAddress: email },
    publicMetadata,
  } as unknown as User;
}

interface MockClerk {
  client: ClerkClient;
  getUserList: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  updateUserMetadata: ReturnType<typeof vi.fn>;
}

function mockClerk(): MockClerk {
  const getUserList = vi.fn();
  const getUser = vi.fn();
  const updateUserMetadata = vi.fn();
  const client = {
    users: { getUserList, getUser, updateUserMetadata },
  } as unknown as ClerkClient;
  return { client, getUserList, getUser, updateUserMetadata };
}

/**
 * A Clerk factory that records whether it was ever invoked. The security tests
 * rely on this: if authorization fails, the factory must never be called (so the
 * Clerk client is never even built, let alone hit over the network).
 */
function spyFactory(client: ClerkClient): { factory: ClerkClientFactory; calls: () => number } {
  let count = 0;
  const factory: ClerkClientFactory = () => {
    count += 1;
    return client;
  };
  return { factory, calls: () => count };
}

/** A factory that fails the test if it is ever called. */
function neverFactory(): ClerkClientFactory {
  return () => {
    throw new Error("Clerk factory must not be invoked when authorization fails");
  };
}

// ---------------------------------------------------------------------------
// AC-4: authorization boundary — the security-critical tests
// ---------------------------------------------------------------------------

describe("authorization boundary (AC-4): Clerk is never reached without admin", () => {
  it("listUsers throws UnauthenticatedError for an anonymous caller and never builds a Clerk client", async () => {
    const { client } = mockClerk();
    const spy = spyFactory(client);
    await expect(listUsersHandler(ctxWithIdentity(null), spy.factory)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(spy.calls()).toBe(0);
  });

  it("listUsers throws PermissionDeniedError for a non-admin (balie) caller and never builds a Clerk client", async () => {
    const { client } = mockClerk();
    const spy = spyFactory(client);
    await expect(
      listUsersHandler(ctxWithIdentity(balieIdentity), spy.factory),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(spy.calls()).toBe(0);
  });

  it("assignRole throws UnauthenticatedError for an anonymous caller and never touches Clerk", async () => {
    await expect(
      assignRoleHandler(ctxWithIdentity(null), neverFactory(), "user_target", "balie"),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("assignRole throws PermissionDeniedError for a non-admin caller and never touches Clerk", async () => {
    const { client, getUser, updateUserMetadata } = mockClerk();
    const spy = spyFactory(client);
    await expect(
      assignRoleHandler(ctxWithIdentity(balieIdentity), spy.factory, "user_target", "behandelaar"),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(spy.calls()).toBe(0);
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUserMetadata).not.toHaveBeenCalled();
  });

  it("removeRole throws UnauthenticatedError for an anonymous caller and never touches Clerk", async () => {
    await expect(
      removeRoleHandler(ctxWithIdentity(null), neverFactory(), "user_target", "balie"),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("removeRole throws PermissionDeniedError for a non-admin caller and never touches Clerk", async () => {
    const { client, getUser, updateUserMetadata } = mockClerk();
    const spy = spyFactory(client);
    await expect(
      removeRoleHandler(ctxWithIdentity(balieIdentity), spy.factory, "user_target", "admin"),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(spy.calls()).toBe(0);
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUserMetadata).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-2 / AC-3: metadata merge / append-only role math through the handlers
// ---------------------------------------------------------------------------

describe("assignRole / removeRole metadata write (AC-2/AC-3)", () => {
  it("assignRole computes the new roles array and preserves other public metadata via Clerk's top-level merge", async () => {
    const { client, getUser, updateUserMetadata } = mockClerk();
    getUser.mockResolvedValue(
      fakeUser({
        id: "user_target",
        publicMetadata: { roles: ["balie"], somethingElse: "x" },
      }),
    );
    // Echo back the merged result Clerk would produce (shallow top-level merge):
    // the unrelated key survives, the roles key is replaced.
    updateUserMetadata.mockResolvedValue(
      fakeUser({
        id: "user_target",
        publicMetadata: { roles: ["balie", "behandelaar"], somethingElse: "x" },
      }),
    );

    const result = await assignRoleHandler(
      ctxWithIdentity(adminIdentity),
      () => client,
      "user_target",
      "behandelaar",
    );

    // We send ONLY the roles key; we rely on Clerk merging it into the existing
    // top-level publicMetadata (so somethingElse is left untouched server-side).
    expect(updateUserMetadata).toHaveBeenCalledWith("user_target", {
      publicMetadata: { roles: ["balie", "behandelaar"] },
    });
    expect(result.roles).toEqual(["balie", "behandelaar"]);
  });

  it("assignRole is idempotent: re-adding a held role writes the same set", async () => {
    const { client, getUser, updateUserMetadata } = mockClerk();
    getUser.mockResolvedValue(
      fakeUser({ id: "user_target", publicMetadata: { roles: ["balie"] } }),
    );
    updateUserMetadata.mockResolvedValue(
      fakeUser({ id: "user_target", publicMetadata: { roles: ["balie"] } }),
    );

    await assignRoleHandler(ctxWithIdentity(adminIdentity), () => client, "user_target", "balie");

    expect(updateUserMetadata).toHaveBeenCalledWith("user_target", {
      publicMetadata: { roles: ["balie"] },
    });
  });

  it("removeRole computes the reduced roles array and preserves other public metadata", async () => {
    const { client, getUser, updateUserMetadata } = mockClerk();
    getUser.mockResolvedValue(
      fakeUser({
        id: "user_target",
        publicMetadata: { roles: ["balie", "behandelaar"], somethingElse: "x" },
      }),
    );
    updateUserMetadata.mockResolvedValue(
      fakeUser({
        id: "user_target",
        publicMetadata: { roles: ["balie"], somethingElse: "x" },
      }),
    );

    const result = await removeRoleHandler(
      ctxWithIdentity(adminIdentity),
      () => client,
      "user_target",
      "behandelaar",
    );

    expect(updateUserMetadata).toHaveBeenCalledWith("user_target", {
      publicMetadata: { roles: ["balie"] },
    });
    expect(result.roles).toEqual(["balie"]);
  });

  it("removeRole drops junk metadata roles before writing (junk cannot survive a write)", async () => {
    const { client, getUser, updateUserMetadata } = mockClerk();
    getUser.mockResolvedValue(
      fakeUser({
        id: "user_target",
        publicMetadata: { roles: ["balie", "superuser", 42, "admin"] },
      }),
    );
    updateUserMetadata.mockResolvedValue(
      fakeUser({ id: "user_target", publicMetadata: { roles: ["balie"] } }),
    );

    await removeRoleHandler(ctxWithIdentity(adminIdentity), () => client, "user_target", "admin");

    // superuser/42 are not recognized roles, so the written set is only the
    // recognized roles minus the removed one — junk is silently discarded.
    expect(updateUserMetadata).toHaveBeenCalledWith("user_target", {
      publicMetadata: { roles: ["balie"] },
    });
  });
});

// ---------------------------------------------------------------------------
// toStaffUser projection (exercised through listUsers)
// ---------------------------------------------------------------------------

describe("toStaffUser projection (via listUsers)", () => {
  async function listOne(user: User): Promise<StaffUser> {
    const { client, getUserList } = mockClerk();
    getUserList.mockResolvedValue({ data: [user], totalCount: 1 });
    const result = await listUsersHandler(ctxWithIdentity(adminIdentity), () => client);
    expect(result).toHaveLength(1);
    return result[0];
  }

  it("composes first + last name", async () => {
    const staff = await listOne(
      fakeUser({
        id: "u1",
        firstName: "Test",
        lastName: "Baliemedewerker",
        email: "t@example.test",
      }),
    );
    expect(staff).toEqual({
      id: "u1",
      name: "Test Baliemedewerker",
      email: "t@example.test",
      roles: [],
    });
  });

  it("uses only the present name part when one is missing", async () => {
    const staff = await listOne(fakeUser({ id: "u2", firstName: "Solo", lastName: null }));
    expect(staff.name).toBe("Solo");
  });

  it("maps an empty/blank name to null", async () => {
    const staff = await listOne(fakeUser({ id: "u3", firstName: null, lastName: null }));
    expect(staff.name).toBeNull();
  });

  it("falls back to null email when there is no primary email address", async () => {
    const staff = await listOne(fakeUser({ id: "u4", firstName: "X", email: null }));
    expect(staff.email).toBeNull();
  });

  it("parses recognized roles from public_metadata and drops junk", async () => {
    const staff = await listOne(
      fakeUser({ id: "u5", publicMetadata: { roles: ["admin", "superuser"] } }),
    );
    expect(staff.roles).toEqual(["admin"]);
  });
});

// ---------------------------------------------------------------------------
// Pagination loop
// ---------------------------------------------------------------------------

describe("listUsers pagination", () => {
  it("pages through multiple Clerk pages and terminates once totalCount is collected", async () => {
    const { client, getUserList } = mockClerk();
    // Two synthetic pages; totalCount=2 across both. Page size constant is 100,
    // but totalCount (not page fill) drives termination here.
    getUserList
      .mockResolvedValueOnce({
        data: [fakeUser({ id: "p1", firstName: "First" })],
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        data: [fakeUser({ id: "p2", firstName: "Second" })],
        totalCount: 2,
      });

    const result = await listUsersHandler(ctxWithIdentity(adminIdentity), () => client);

    expect(getUserList).toHaveBeenCalledTimes(2);
    expect(getUserList).toHaveBeenNthCalledWith(1, {
      limit: 100,
      offset: 0,
      orderBy: "+created_at",
    });
    expect(getUserList).toHaveBeenNthCalledWith(2, {
      limit: 100,
      offset: 100,
      orderBy: "+created_at",
    });
    expect(result.map((u) => u.id)).toEqual(["p1", "p2"]);
  });

  it("terminates on an empty page even if totalCount over-reports", async () => {
    const { client, getUserList } = mockClerk();
    getUserList
      .mockResolvedValueOnce({ data: [fakeUser({ id: "p1" })], totalCount: 999 })
      .mockResolvedValueOnce({ data: [], totalCount: 999 });

    const result = await listUsersHandler(ctxWithIdentity(adminIdentity), () => client);

    expect(getUserList).toHaveBeenCalledTimes(2);
    expect(result.map((u) => u.id)).toEqual(["p1"]);
  });

  it("returns an empty list when the directory is empty", async () => {
    const { client, getUserList } = mockClerk();
    getUserList.mockResolvedValue({ data: [], totalCount: 0 });

    const result = await listUsersHandler(ctxWithIdentity(adminIdentity), () => client);

    expect(getUserList).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behandelaar selection list (Story A-1-S1; FR-6, BR-7)
// ---------------------------------------------------------------------------

const behandelaarIdentity = {
  subject: "user_synthetic_behandelaar",
  issuer: "https://example.clerk.accounts.dev",
  tokenIdentifier: "https://example.clerk.accounts.dev|user_synthetic_behandelaar",
  roles: ["behandelaar"],
} as unknown as UserIdentity;

describe("selectActiveBehandelaars (BR-7, pure)", () => {
  function candidate(over: Partial<BehandelaarCandidate> = {}): BehandelaarCandidate {
    return { id: "u", name: "Naam", roles: ["behandelaar"], banned: false, locked: false, ...over };
  }

  it("includes active behandelaars, including multi-role ones (A-2)", () => {
    const out = selectActiveBehandelaars([
      candidate({ id: "a", name: "Anna", roles: ["behandelaar"] }),
      candidate({ id: "b", name: "Bram", roles: ["behandelaar", "balie"] }),
    ]);
    expect(out.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("excludes users without the behandelaar role", () => {
    expect(selectActiveBehandelaars([candidate({ id: "x", roles: ["balie", "admin"] })])).toEqual(
      [],
    );
  });

  it("excludes deactivated (banned or locked) behandelaars (BR-7)", () => {
    expect(
      selectActiveBehandelaars([
        candidate({ id: "banned", banned: true }),
        candidate({ id: "locked", locked: true }),
      ]),
    ).toEqual([]);
  });

  it("sorts by name with Dutch collation", () => {
    const out = selectActiveBehandelaars([
      candidate({ id: "z", name: "Zoë" }),
      candidate({ id: "a", name: "Aart" }),
    ]);
    expect(out.map((b) => b.name)).toEqual(["Aart", "Zoë"]);
  });

  it("projects to id + name only", () => {
    const [option] = selectActiveBehandelaars([candidate({ id: "a", name: "Anna" })]);
    expect(Object.keys(option as Behandelaar).sort()).toEqual(["id", "name"]);
  });
});

describe("listBehandelaarsHandler (auth + active filter)", () => {
  /** A Clerk `User` with role metadata plus the banned/locked account flags. */
  function staffUser(over: {
    id: string;
    firstName?: string | null;
    roles?: string[];
    banned?: boolean;
    locked?: boolean;
  }): User {
    return {
      ...fakeUser({
        id: over.id,
        firstName: over.firstName ?? null,
        publicMetadata: { roles: over.roles ?? [] },
      }),
      banned: over.banned ?? false,
      locked: over.locked ?? false,
    } as User;
  }

  it("denies a behandelaar-only caller and never builds a Clerk client (AC-2)", async () => {
    const { client } = mockClerk();
    const spy = spyFactory(client);
    await expect(
      listBehandelaarsHandler(ctxWithIdentity(behandelaarIdentity), spy.factory),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(spy.calls()).toBe(0);
  });

  it("denies an anonymous caller", async () => {
    await expect(
      listBehandelaarsHandler(ctxWithIdentity(null), neverFactory()),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("allows balie and returns only active behandelaars", async () => {
    const { client, getUserList } = mockClerk();
    getUserList.mockResolvedValue({
      data: [
        staffUser({ id: "b1", firstName: "Bea", roles: ["behandelaar"] }),
        staffUser({ id: "b2", firstName: "Ban", roles: ["behandelaar"], banned: true }),
        staffUser({ id: "r1", firstName: "Rik", roles: ["balie"] }),
      ],
      totalCount: 3,
    });
    const out = await listBehandelaarsHandler(ctxWithIdentity(balieIdentity), () => client);
    expect(out.map((b) => b.id)).toEqual(["b1"]);
  });
});
