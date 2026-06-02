import { describe, expect, it } from "vitest";
import { isPublicPath } from "./routes";

describe("isPublicPath (Clerk route protection policy)", () => {
  it("treats the sign-in and sign-up routes as public", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-up")).toBe(true);
  });

  it("treats nested Clerk sub-routes (SSO callbacks, factor steps) as public", () => {
    expect(isPublicPath("/sign-in/factor-one")).toBe(true);
    expect(isPublicPath("/sign-up/verify-email-address")).toBe(true);
  });

  it("treats EPD application routes as protected", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/patienten")).toBe(false);
    expect(isPublicPath("/afspraken")).toBe(false);
    expect(isPublicPath("/behandelingen")).toBe(false);
  });

  it("does not treat unrelated paths that merely contain the prefix as public", () => {
    expect(isPublicPath("/sign-in-history")).toBe(false);
    expect(isPublicPath("/admin/sign-in")).toBe(false);
  });
});
