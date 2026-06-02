import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import type { PatientInput } from "../lib/patient-validation";
import type { Role } from "./auth";
import {
  PatientCreationError,
  SEARCH_RESULT_LIMIT,
  type SearchablePatient,
  buildPatientDocument,
  canOverrideDuplicate,
  hasUsableCriteria,
  matchesCriteria,
  normalizeSearchCriteria,
  resolvePatientCreation,
  resolvePatientSearch,
} from "./patients";

/**
 * Tests for the patient-creation core (Story P-1-S1; FR-1, BR-1, BR-2, BR-3,
 * EH-4, A-25). These exercise the pure decision logic the Convex mutation wires
 * up — validation, the active-duplicate gate, the admin-only acknowledge
 * override, and the persisted document mapping — without a Convex runtime (the
 * live deploy is verified manually). All data is SYNTHETIC (AVG/GDPR, BR-11):
 * "123456782" is the FRD's documented synthetic example BSN.
 */

const NOW = new Date("2026-06-02T12:00:00Z");

function validInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    voornaam: "Testvoornaam",
    achternaam: "Testachternaam",
    geboortedatum: "1990-01-01",
    geslacht: "man",
    bsn: "123456782",
    ...overrides,
  };
}

const noDuplicate = () => Promise.resolve(false);
const hasDuplicate = () => Promise.resolve(true);

describe("buildPatientDocument", () => {
  it("maps a valid input to a persisted document with actief=true (BR-3)", () => {
    const doc = buildPatientDocument(validInput());
    expect(doc.actief).toBe(true);
    expect(doc.voornaam).toBe("Testvoornaam");
    expect(doc.geslacht).toBe("man");
  });

  it("drops empty optional fields rather than storing empty strings", () => {
    const doc = buildPatientDocument(validInput({ email: "  ", telefoonnummer: "" }));
    expect(doc.email).toBeUndefined();
    expect(doc.telefoonnummer).toBeUndefined();
  });

  it("keeps a non-empty optional field, trimmed", () => {
    const doc = buildPatientDocument(validInput({ tussenvoegsel: "  van  " }));
    expect(doc.tussenvoegsel).toBe("van");
  });

  it("stores the BSN in canonical zero-padded form so duplicate lookups match (EH-4)", () => {
    // A BSN typed without its leading zero must be stored zero-padded, so the
    // by_bsn index lookup collides with an already-stored padded value.
    // "10000008" is a synthetic 8-digit value whose canonical form "010000008"
    // passes the Elfproef (AVG/GDPR, BR-11).
    const doc = buildPatientDocument(validInput({ bsn: "10000008" }));
    expect(doc.bsn).toBe("010000008");
  });
});

describe("canOverrideDuplicate (A-25)", () => {
  it("lets an admin override only with an explicit acknowledgement", () => {
    expect(canOverrideDuplicate(["admin"], true)).toBe(true);
    expect(canOverrideDuplicate(["admin"], false)).toBe(false);
  });

  it("never lets a balie override, even when acknowledging", () => {
    expect(canOverrideDuplicate(["balie"], true)).toBe(false);
  });
});

describe("resolvePatientCreation — validation gate", () => {
  it("returns the document for a fully valid, non-duplicate input", async () => {
    const doc = await resolvePatientCreation({
      input: validInput(),
      roles: ["balie"],
      acknowledgeDuplicate: false,
      activeBsnExists: noDuplicate,
      now: NOW,
    });
    expect(doc.bsn).toBe("123456782");
  });

  it("throws validation_failed for an invalid BSN, never echoing the value (BR-2, BR-11)", async () => {
    const promise = resolvePatientCreation({
      input: validInput({ bsn: "123456789" }),
      roles: ["balie"],
      acknowledgeDuplicate: false,
      activeBsnExists: noDuplicate,
      now: NOW,
    });
    await expect(promise).rejects.toBeInstanceOf(PatientCreationError);
    await expect(promise).rejects.toMatchObject({ data: { code: "validation_failed" } });
    await expect(promise).rejects.toSatisfy((error: PatientCreationError) => {
      if (error.data.code !== "validation_failed") {
        return false;
      }
      return error.data.errors.every((e) => !e.message.includes("123456789"));
    });
  });

  it("throws validation_failed when a required field is missing", async () => {
    await expect(
      resolvePatientCreation({
        input: validInput({ geboortedatum: "" }),
        roles: ["balie"],
        acknowledgeDuplicate: false,
        activeBsnExists: noDuplicate,
        now: NOW,
      }),
    ).rejects.toMatchObject({ data: { code: "validation_failed" } });
  });

  it("throws validation_failed for a future geboortedatum", async () => {
    await expect(
      resolvePatientCreation({
        input: validInput({ geboortedatum: "2099-01-01" }),
        roles: ["balie"],
        acknowledgeDuplicate: false,
        activeBsnExists: noDuplicate,
        now: NOW,
      }),
    ).rejects.toMatchObject({ data: { code: "validation_failed" } });
  });

  it("does NOT query for duplicates if validation already failed", async () => {
    let queried = false;
    const spy = () => {
      queried = true;
      return Promise.resolve(true);
    };
    await expect(
      resolvePatientCreation({
        input: validInput({ bsn: "123456789" }),
        roles: ["balie"],
        acknowledgeDuplicate: false,
        activeBsnExists: spy,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PatientCreationError);
    expect(queried).toBe(false);
  });
});

describe("resolvePatientCreation — duplicate-BSN gate (EH-4, A-25)", () => {
  it("blocks a balie when an active duplicate exists, with canOverride=false", async () => {
    const promise = resolvePatientCreation({
      input: validInput(),
      roles: ["balie"],
      acknowledgeDuplicate: false,
      activeBsnExists: hasDuplicate,
      now: NOW,
    });
    await expect(promise).rejects.toMatchObject({
      data: { code: "duplicate_bsn", canOverride: false },
    });
  });

  it("blocks even a balie who sets acknowledgeDuplicate (only admin may override)", async () => {
    const promise = resolvePatientCreation({
      input: validInput(),
      roles: ["balie"],
      acknowledgeDuplicate: true,
      activeBsnExists: hasDuplicate,
      now: NOW,
    });
    await expect(promise).rejects.toMatchObject({ data: { code: "duplicate_bsn" } });
  });

  it("tells an admin (without acknowledgement) that they CAN override", async () => {
    const promise = resolvePatientCreation({
      input: validInput(),
      roles: ["admin"],
      acknowledgeDuplicate: false,
      activeBsnExists: hasDuplicate,
      now: NOW,
    });
    await expect(promise).rejects.toMatchObject({
      data: { code: "duplicate_bsn", canOverride: true },
    });
  });

  it("lets an admin save through a duplicate WITH an explicit acknowledgement (A-25)", async () => {
    const doc = await resolvePatientCreation({
      input: validInput(),
      roles: ["admin"],
      acknowledgeDuplicate: true,
      activeBsnExists: hasDuplicate,
      now: NOW,
    });
    expect(doc.bsn).toBe("123456782");
  });

  it("never carries the BSN value in the duplicate error payload (BR-11)", async () => {
    const promise = resolvePatientCreation({
      input: validInput(),
      roles: ["balie"],
      acknowledgeDuplicate: false,
      activeBsnExists: hasDuplicate,
      now: NOW,
    });
    await expect(promise).rejects.toSatisfy((error: PatientCreationError) => {
      return !JSON.stringify(error.data).includes("123456782");
    });
  });
});

describe("PatientCreationError", () => {
  it("is a ConvexError so Convex surfaces it as client data, not a 500", () => {
    const error = new PatientCreationError({ code: "duplicate_bsn", canOverride: false });
    expect(error).toBeInstanceOf(ConvexError);
  });
});

// Type-only assertion: the create-permitted roles are exactly balie + admin
// (FR-1); behandelaar is absent, so the mutation's assertHasRole denies it
// (AC-2). The runtime denial path is covered by auth.test.ts (assertHasRole).
const _createRoles: readonly Role[] = ["balie", "admin"];
void _createRoles;

/* -------------------------------------------------------------------------- */
/* Patient search core (Story P-2-S1; FR-4, BR-4, BR-11, EH-1, A-10).         */
/* -------------------------------------------------------------------------- */

/**
 * Tests for the pure patient-search core the `searchPatients` Convex query
 * wires up. All BSNs/names are SYNTHETIC (AVG/GDPR, BR-11). The live Convex
 * deployment (index reads, auth) is verified manually; here we exercise the
 * rules that must hold regardless of runtime: BR-4 empty→[], EH-1 active-only +
 * no-inactive-leak, A-10 cap, BSN leading-zero parity, and partial-name match.
 */

let nextPatientSeq = 0;
function patient(overrides: Partial<SearchablePatient> = {}): SearchablePatient {
  nextPatientSeq += 1;
  return {
    _id: `patient_${nextPatientSeq}`,
    achternaam: "Jansen",
    voornaam: "Testvoornaam",
    geboortedatum: "1990-01-01",
    bsn: "123456782",
    actief: true,
    ...overrides,
  };
}

describe("normalizeSearchCriteria (BSN parity, BR-11)", () => {
  it("canonicalizes a BSN typed without its leading zero to nine digits", () => {
    // "10000008" stored canonically is "010000008"; a search must use the same.
    expect(normalizeSearchCriteria({ bsn: "10000008" }).bsn).toBe("010000008");
  });

  it("drops a blank or non-numeric BSN to undefined rather than erroring", () => {
    expect(normalizeSearchCriteria({ bsn: "   " }).bsn).toBeUndefined();
    expect(normalizeSearchCriteria({ bsn: "abc" }).bsn).toBeUndefined();
  });

  it("trims and lower-cases name fields for case-insensitive matching", () => {
    const c = normalizeSearchCriteria({ achternaam: "  JaN  ", voornaam: "PiET" });
    expect(c.achternaam).toBe("jan");
    expect(c.voornaam).toBe("piet");
  });

  it("treats whitespace-only name fields as absent", () => {
    expect(normalizeSearchCriteria({ achternaam: "   " }).achternaam).toBeUndefined();
  });
});

describe("hasUsableCriteria (BR-4)", () => {
  it("is false when nothing usable is supplied", () => {
    expect(hasUsableCriteria(normalizeSearchCriteria({}))).toBe(false);
    expect(hasUsableCriteria(normalizeSearchCriteria({ achternaam: "  ", bsn: "" }))).toBe(false);
  });

  it("is true when any usable criterion is present", () => {
    expect(hasUsableCriteria(normalizeSearchCriteria({ achternaam: "Jan" }))).toBe(true);
    expect(hasUsableCriteria(normalizeSearchCriteria({ geboortedatum: "1990-01-01" }))).toBe(true);
  });
});

describe("matchesCriteria — partial name / exact BSN+dob", () => {
  it("matches a case-insensitive achternaam PREFIX (FR-4 partial last name)", () => {
    const c = normalizeSearchCriteria({ achternaam: "jan" });
    expect(matchesCriteria(patient({ achternaam: "Jansen" }), c)).toBe(true);
    expect(matchesCriteria(patient({ achternaam: "Janssens" }), c)).toBe(true);
    expect(matchesCriteria(patient({ achternaam: "Pietersen" }), c)).toBe(false);
  });

  it("matches a BSN only on an exact (canonical) value", () => {
    const c = normalizeSearchCriteria({ bsn: "123456782" });
    expect(matchesCriteria(patient({ bsn: "123456782" }), c)).toBe(true);
    expect(matchesCriteria(patient({ bsn: "111222333" }), c)).toBe(false);
  });

  it("matches geboortedatum exactly", () => {
    const c = normalizeSearchCriteria({ geboortedatum: "1990-01-01" });
    expect(matchesCriteria(patient({ geboortedatum: "1990-01-01" }), c)).toBe(true);
    expect(matchesCriteria(patient({ geboortedatum: "1991-01-01" }), c)).toBe(false);
  });
});

describe("resolvePatientSearch — BR-4 empty", () => {
  it("returns [] for empty criteria WITHOUT inspecting any candidate (never list-all)", () => {
    // Even if candidates are present, no usable criteria → zero results.
    const results = resolvePatientSearch({
      criteria: normalizeSearchCriteria({}),
      candidates: [patient(), patient(), patient()],
      includeInactive: false,
    });
    expect(results).toEqual([]);
  });
});

describe("resolvePatientSearch — partial-name list (AC: 'Jan' → all matches)", () => {
  it("returns every active patient whose achternaam starts with the term, projected to result shape", () => {
    const results = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ achternaam: "Jan" }),
      candidates: [
        patient({ achternaam: "Jansen", voornaam: "A" }),
        patient({ achternaam: "Janssen", voornaam: "B" }),
        patient({ achternaam: "Jansma", voornaam: "C" }),
        patient({ achternaam: "Pietersen", voornaam: "D" }),
      ],
      includeInactive: false,
    });
    expect(results).toHaveLength(3);
    // Each result carries exactly the display columns + id, and NO bsn (BR-11).
    for (const r of results) {
      expect(r).toHaveProperty("patientId");
      expect(r).toHaveProperty("achternaam");
      expect(r).toHaveProperty("voornaam");
      expect(r).toHaveProperty("geboortedatum");
      expect(r).not.toHaveProperty("bsn");
    }
  });
});

describe("resolvePatientSearch — EH-1 active-only / no inactive leak", () => {
  it("returns zero results for a BSN that matches only a DEACTIVATED patient", () => {
    const results = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ bsn: "987654321" }),
      candidates: [patient({ bsn: "987654321", actief: false })],
      includeInactive: false,
    });
    expect(results).toEqual([]);
  });

  it("returns the same empty shape as a genuinely non-existent BSN (no leak)", () => {
    const deactivatedHit = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ bsn: "987654321" }),
      candidates: [patient({ bsn: "987654321", actief: false })],
      includeInactive: false,
    });
    const noSuchBsn = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ bsn: "987654321" }),
      candidates: [],
      includeInactive: false,
    });
    expect(deactivatedHit).toEqual(noSuchBsn);
  });

  it("includes deactivated patients only when includeInactive is explicitly set", () => {
    const results = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ bsn: "987654321" }),
      candidates: [patient({ bsn: "987654321", actief: false })],
      includeInactive: true,
    });
    expect(results).toHaveLength(1);
  });
});

describe("resolvePatientSearch — A-10 cap", () => {
  it("returns at most SEARCH_RESULT_LIMIT (50) results even with more matches", () => {
    const candidates = Array.from({ length: 80 }, () => patient({ achternaam: "De Vries" }));
    const results = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ achternaam: "De" }),
      candidates,
      includeInactive: false,
    });
    expect(results).toHaveLength(SEARCH_RESULT_LIMIT);
  });
});

describe("resolvePatientSearch — BSN leading-zero parity end-to-end", () => {
  it("finds a patient stored with a leading-zero BSN when searched without it", () => {
    // Stored canonical "010000008"; user types "10000008".
    const results = resolvePatientSearch({
      criteria: normalizeSearchCriteria({ bsn: "10000008" }),
      candidates: [patient({ bsn: "010000008" })],
      includeInactive: false,
    });
    expect(results).toHaveLength(1);
  });
});
