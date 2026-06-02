import { describe, expect, it } from "vitest";
import { scaffoldHealthcheck } from "./health";

describe("scaffold", () => {
  it("toolchain runs a passing test", () => {
    expect(scaffoldHealthcheck()).toBe("ok");
  });
});
