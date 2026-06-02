import { describe, expect, it } from "vitest";
import { isValidBsn, normalizeBsn } from "./bsn";

/**
 * Elfproef BSN validator tests (BR-2). Every BSN below is SYNTHETIC: it is not a
 * real person's number. "123456782" is the FRD's documented example test value;
 * the other "valid" numbers are hand-constructed to satisfy the Elfproef and do
 * not identify anyone (AVG/GDPR, BR-10/BR-11).
 */

// Synthetic 9-digit numbers that satisfy the Elfproef weighted-sum-mod-11 check.
const VALID_SYNTHETIC_BSNS = ["123456782", "111222333", "100000009"];

describe("isValidBsn (Elfproef, BR-2)", () => {
  it("accepts the FRD's documented synthetic example BSN", () => {
    expect(isValidBsn("123456782")).toBe(true);
  });

  it.each(VALID_SYNTHETIC_BSNS)("accepts the synthetic valid BSN %s", (bsn) => {
    expect(isValidBsn(bsn)).toBe(true);
  });

  it("rejects a 9-digit number that fails the Elfproef", () => {
    // 123456789 -> weighted sum is not divisible by 11.
    expect(isValidBsn("123456789")).toBe(false);
  });

  it("rejects the all-zeros number even though it satisfies the arithmetic", () => {
    expect(isValidBsn("000000000")).toBe(false);
  });

  it("rejects a too-short number", () => {
    expect(isValidBsn("1234567")).toBe(false);
  });

  it("rejects a too-long number", () => {
    expect(isValidBsn("1234567820")).toBe(false);
  });

  it("rejects non-digit content", () => {
    expect(isValidBsn("12345678a")).toBe(false);
    expect(isValidBsn("123-456-782")).toBe(false);
    expect(isValidBsn("")).toBe(false);
  });

  it("tolerates surrounding whitespace around an otherwise valid BSN", () => {
    expect(isValidBsn("  123456782  ")).toBe(true);
  });
});

describe("normalizeBsn", () => {
  it("trims whitespace and returns the nine-digit string", () => {
    expect(normalizeBsn("  123456782 ")).toBe("123456782");
  });

  it("left-pads a shorter all-digit value to nine characters", () => {
    expect(normalizeBsn("123")).toBe("000000123");
  });

  it("returns null for non-digit or over-length input", () => {
    expect(normalizeBsn("abc")).toBeNull();
    expect(normalizeBsn("1234567890")).toBeNull();
  });
});
