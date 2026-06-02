import { createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTE_PATTERNS } from "./routes";

/**
 * Exercise the *real* Clerk route matcher that middleware.ts uses, built from
 * the same PUBLIC_ROUTE_PATTERNS. createRouteMatcher only reads
 * `request.nextUrl.pathname`, so a minimal stub request is enough to assert how
 * the live middleware classifies a path — without re-implementing the matcher.
 */
const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTE_PATTERNS]);

function classify(pathname: string): boolean {
  return isPublicRoute({ nextUrl: { pathname } } as unknown as NextRequest);
}

describe("Clerk public-route matcher (middleware gate)", () => {
  it("treats the sign-in and sign-up pages as public", () => {
    expect(classify("/sign-in")).toBe(true);
    expect(classify("/sign-up")).toBe(true);
  });

  it("treats nested Clerk sub-routes (SSO callbacks, factor steps) as public", () => {
    expect(classify("/sign-in/factor-one")).toBe(true);
    expect(classify("/sign-up/verify-email-address")).toBe(true);
  });

  it("treats EPD application routes as protected", () => {
    expect(classify("/")).toBe(false);
    expect(classify("/patienten")).toBe(false);
    expect(classify("/afspraken")).toBe(false);
    expect(classify("/behandelingen")).toBe(false);
  });

  it("does not make paths that merely share the prefix public", () => {
    // Guards against the `/sign-in(.*)` suffix-wildcard mistake: these must NOT
    // match the live matcher, or they would be silently exposed.
    expect(classify("/sign-in-history")).toBe(false);
    expect(classify("/sign-uphill")).toBe(false);
    expect(classify("/admin/sign-in")).toBe(false);
  });
});
