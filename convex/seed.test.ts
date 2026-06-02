import { describe, expect, it } from "vitest";
import { DEFAULT_BEHANDELSOORTEN, missingBehandelsoorten } from "./seed";

/**
 * Unit tests for the behandelsoort seed logic (Story B-3-S1). They verify the
 * idempotency rule — seed only the entries that are missing — without a Convex
 * runtime. Synthetic vocabulary only; no patient-identifying data (BR-10).
 */

describe("missingBehandelsoorten (idempotent seed selection)", () => {
  it("returns every default when the collection is empty", () => {
    expect(missingBehandelsoorten([])).toEqual([...DEFAULT_BEHANDELSOORTEN]);
  });

  it("returns nothing when all defaults already exist (re-run is a no-op)", () => {
    expect(missingBehandelsoorten([...DEFAULT_BEHANDELSOORTEN])).toEqual([]);
  });

  it("returns only the defaults not yet present", () => {
    const existing: string[] = [DEFAULT_BEHANDELSOORTEN[0], DEFAULT_BEHANDELSOORTEN[2]];
    expect(missingBehandelsoorten(existing)).toEqual(
      DEFAULT_BEHANDELSOORTEN.filter((naam) => !existing.includes(naam)),
    );
  });

  it("ignores unrelated existing names", () => {
    expect(missingBehandelsoorten(["Iets anders"])).toEqual([...DEFAULT_BEHANDELSOORTEN]);
  });

  it("defines a non-empty set of unique default names", () => {
    expect(DEFAULT_BEHANDELSOORTEN.length).toBeGreaterThan(0);
    expect(new Set(DEFAULT_BEHANDELSOORTEN).size).toBe(DEFAULT_BEHANDELSOORTEN.length);
  });
});
