import { ConvexError, type GenericId } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  type BehandelsoortDoc,
  type BehandelsoortReader,
  InactiveBehandelsoortError,
  assertActiveBehandelsoort,
  toActiveOptions,
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
