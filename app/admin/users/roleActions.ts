import type { Role } from "@/convex/auth";
import type { StaffUser } from "@/convex/users";
import { makeFunctionReference } from "convex/server";

/**
 * Typed references to the admin user/role Convex actions (convex/users.ts).
 *
 * The project has no generated `convex/_generated/api` yet (that file appears
 * only after `npx convex dev` runs codegen), so the frontend bridges to the
 * actions with `makeFunctionReference`, naming them by their `file:export`
 * path. The explicit type arguments restore end-to-end typing of the action
 * args and return values at the call sites (useAction), matching the shapes
 * declared in convex/users.ts. Once codegen exists these can be swapped for
 * `api.users.*` with no change to the call sites' types.
 */

export const listUsersRef = makeFunctionReference<"action", Record<string, never>, StaffUser[]>(
  "users:listUsers",
);

export const assignRoleRef = makeFunctionReference<
  "action",
  { userId: string; role: Role },
  StaffUser
>("users:assignRole");

export const removeRoleRef = makeFunctionReference<
  "action",
  { userId: string; role: Role },
  StaffUser
>("users:removeRole");
