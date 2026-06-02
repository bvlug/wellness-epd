import { ConvexError, type GenericId } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  BEHANDELSOORT_NAAM_MAX_LENGTH,
  type BehandelsoortDoc,
  BehandelsoortNaamError,
  type BehandelsoortReader,
  BehandelsoortReferencedError,
  InactiveBehandelsoortError,
  assertActiveBehandelsoort,
  assertDeletable,
  normalizeBehandelsoortNaam,
  toActiveOptions,
  toAdminRows,
} from "./behandelsoort";

/**
 * Unit tests for the behandelsoort read + validation logic (Story B-3-S1).
 * They exercise the pure helpers directly rather than spinning up a Convex
 * runtime (mirroring convex/auth.test.ts). All data is synthetic controlled
 * vocabulary — no patient-identifying data (BR-10).
 */

/** Builds a synthetic behandelsoort document with a fake, branded id. */
function bs(naam: string, actief: boolean): BehandelsoortDoc {
  return { _id: `bs_${naam}` as unknown as GenericId<"behandelsoort">, naam, actief };
}

describe("toActiveOptions (dropdown projection)", () => {
  it("returns all active entries when none are deactivated (AC: active entries appear)", () => {
    const rows = [bs("Sportmassage", true), bs("Klassieke massage", true), bs("Hot stone", true)];
    expect(toActiveOptions(rows).map((o) => o.naam)).toEqual([
      "Hot stone",
      "Klassieke massage",
      "Sportmassage",
    ]);
  });

  it("excludes deactivated entries (AC: deactivated entries do not appear)", () => {
    const rows = [bs("Actief A", true), bs("Inactief", false), bs("Actief B", true)];
    expect(toActiveOptions(rows).map((o) => o.naam)).toEqual(["Actief A", "Actief B"]);
  });

  it("sorts by naam using Dutch collation", () => {
    const rows = [bs("Zonnebank", true), bs("Acupunctuur", true), bs("Massage", true)];
    expect(toActiveOptions(rows).map((o) => o.naam)).toEqual([
      "Acupunctuur",
      "Massage",
      "Zonnebank",
    ]);
  });

  it("projects to id + naam only, never leaking the actief flag", () => {
    const [option] = toActiveOptions([bs("Sportmassage", true)]);
    expect(Object.keys(option).sort()).toEqual(["_id", "naam"]);
  });

  it("returns an empty list when there are no entries", () => {
    expect(toActiveOptions([])).toEqual([]);
  });
});

describe("assertActiveBehandelsoort (BR-12 referential guard)", () => {
  /** A reader whose `get` returns whatever document is registered for an id. */
  function reader(doc: BehandelsoortDoc | null): BehandelsoortReader {
    return { get: () => Promise.resolve(doc) };
  }

  const someId = "bs_x" as unknown as GenericId<"behandelsoort">;

  it("returns the document when the behandelsoort is active", async () => {
    const active = bs("Sportmassage", true);
    await expect(assertActiveBehandelsoort(reader(active), someId)).resolves.toBe(active);
  });

  it("throws when the behandelsoort is deactivated (AC: validates on save)", async () => {
    await expect(
      assertActiveBehandelsoort(reader(bs("Sportmassage", false)), someId),
    ).rejects.toBeInstanceOf(InactiveBehandelsoortError);
  });

  it("throws when the behandelsoort does not exist", async () => {
    await expect(assertActiveBehandelsoort(reader(null), someId)).rejects.toBeInstanceOf(
      InactiveBehandelsoortError,
    );
  });

  it("throws a structured ConvexError carrying a non-identifying code", async () => {
    await expect(
      assertActiveBehandelsoort(reader(bs("Sportmassage", false)), someId),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ConvexError &&
        (error as ConvexError<{ code: string }>).data.code === "inactive_behandelsoort",
    );
  });
});

describe("toAdminRows (admin management projection)", () => {
  it("includes both active and inactive entries (unlike the dropdown projection)", () => {
    const rows = [bs("Sportmassage", true), bs("Oud", false)];
    expect(toAdminRows(rows).map((r) => r.naam)).toEqual(["Sportmassage", "Oud"]);
  });

  it("keeps the actief flag on each row so the admin can see state", () => {
    const [row] = toAdminRows([bs("Sportmassage", false)]);
    expect(row.actief).toBe(false);
    expect(Object.keys(row).sort()).toEqual(["_id", "actief", "naam"]);
  });

  it("lists active entries before inactive ones, each sorted by Dutch collation", () => {
    const rows = [
      bs("Zonnebank", true),
      bs("Beëindigd", false),
      bs("Acupunctuur", true),
      bs("Afgevoerd", false),
    ];
    expect(toAdminRows(rows).map((r) => r.naam)).toEqual([
      "Acupunctuur",
      "Zonnebank",
      "Afgevoerd",
      "Beëindigd",
    ]);
  });

  it("returns an empty list when there are no entries", () => {
    expect(toAdminRows([])).toEqual([]);
  });
});

describe("normalizeBehandelsoortNaam (admin create/rename validation)", () => {
  it("trims surrounding whitespace and returns the canonical value", () => {
    expect(normalizeBehandelsoortNaam("  Sportmassage  ")).toBe("Sportmassage");
  });

  it("accepts a normal vocabulary label unchanged", () => {
    expect(normalizeBehandelsoortNaam("Klassieke massage")).toBe("Klassieke massage");
  });

  it("rejects an empty name (BehandelsoortNaamError 'empty')", () => {
    expect(() => normalizeBehandelsoortNaam("   ")).toThrow(BehandelsoortNaamError);
    try {
      normalizeBehandelsoortNaam("");
    } catch (error) {
      expect((error as BehandelsoortNaamError).data).toEqual({
        code: "invalid_naam",
        reason: "empty",
      });
    }
  });

  it("rejects a name longer than the max length ('too_long')", () => {
    const tooLong = "x".repeat(BEHANDELSOORT_NAAM_MAX_LENGTH + 1);
    try {
      normalizeBehandelsoortNaam(tooLong);
      throw new Error("expected normalizeBehandelsoortNaam to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BehandelsoortNaamError);
      expect((error as BehandelsoortNaamError).data).toEqual({
        code: "invalid_naam",
        reason: "too_long",
      });
    }
  });

  it("accepts a name exactly at the max length", () => {
    const atLimit = "x".repeat(BEHANDELSOORT_NAAM_MAX_LENGTH);
    expect(normalizeBehandelsoortNaam(atLimit)).toBe(atLimit);
  });
});

describe("assertDeletable (A-27 referential integrity)", () => {
  it("permits deletion when nothing references the entry", () => {
    expect(() => assertDeletable({ afspraken: 0, behandelingen: 0 })).not.toThrow();
  });

  it("blocks deletion when an afspraak references the entry", () => {
    expect(() => assertDeletable({ afspraken: 1, behandelingen: 0 })).toThrow(
      BehandelsoortReferencedError,
    );
  });

  it("blocks deletion when a behandeling references the entry", () => {
    expect(() => assertDeletable({ afspraken: 0, behandelingen: 1 })).toThrow(
      BehandelsoortReferencedError,
    );
  });

  it("blocks deletion when both an afspraak and a behandeling reference the entry", () => {
    expect(() => assertDeletable({ afspraken: 3, behandelingen: 2 })).toThrow(
      BehandelsoortReferencedError,
    );
  });

  it("throws a structured ConvexError carrying a non-identifying code (A-27)", () => {
    try {
      assertDeletable({ afspraken: 1, behandelingen: 0 });
      throw new Error("expected assertDeletable to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<{ code: string }>).data).toEqual({
        code: "behandelsoort_referenced",
      });
    }
  });
});
