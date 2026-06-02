import { describe, expect, it } from "vitest";
import { type PatientInput, isGeslacht, validatePatientInput } from "./patient-validation";

/**
 * Tests for the shared new-patient validation (Story P-1-S1; FR-1, BR-1, BR-2).
 * All data is SYNTHETIC — no real names or BSNs (AVG/GDPR, BR-10/BR-11).
 * "123456782" is the FRD's documented synthetic example BSN.
 */

// A fixed "now" so the geboortedatum-in-the-past rule is deterministic.
const NOW = new Date("2026-06-02T12:00:00Z");

function validInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    voornaam: "Testvoornaam",
    achternaam: "Testachternaam",
    geboortedatum: "1990-01-01",
    geslacht: "vrouw",
    bsn: "123456782",
    ...overrides,
  };
}

describe("validatePatientInput — happy path", () => {
  it("returns no errors for a fully valid input", () => {
    expect(validatePatientInput(validInput(), NOW)).toEqual([]);
  });
});

describe("required fields", () => {
  it.each(["voornaam", "achternaam", "geboortedatum", "geslacht", "bsn"] as const)(
    "flags missing %s as required",
    (field) => {
      const errors = validatePatientInput(validInput({ [field]: "  " }), NOW);
      expect(errors).toContainEqual(expect.objectContaining({ field, code: "required" }));
    },
  );
});

describe("geslacht controlled vocabulary (BR-1)", () => {
  it("accepts each controlled value", () => {
    for (const geslacht of ["man", "vrouw", "overig", "onbekend"]) {
      expect(validatePatientInput(validInput({ geslacht }), NOW)).toEqual([]);
    }
  });

  it("rejects an out-of-vocabulary value", () => {
    const errors = validatePatientInput(validInput({ geslacht: "anders" }), NOW);
    expect(errors).toContainEqual(
      expect.objectContaining({ field: "geslacht", code: "geslacht_invalid" }),
    );
  });

  it("isGeslacht guards the controlled set", () => {
    expect(isGeslacht("man")).toBe(true);
    expect(isGeslacht("anders")).toBe(false);
  });
});

describe("BSN (BR-2, BR-11)", () => {
  it("rejects a BSN that fails the Elfproef", () => {
    const errors = validatePatientInput(validInput({ bsn: "123456789" }), NOW);
    expect(errors).toContainEqual(expect.objectContaining({ field: "bsn", code: "bsn_invalid" }));
  });

  it("never echoes the entered BSN in the error message (BR-11)", () => {
    const errors = validatePatientInput(validInput({ bsn: "123456789" }), NOW);
    for (const error of errors) {
      expect(error.message).not.toContain("123456789");
    }
  });
});

describe("geboortedatum must be a real, past date", () => {
  it("rejects a future date", () => {
    const errors = validatePatientInput(validInput({ geboortedatum: "2099-01-01" }), NOW);
    expect(errors).toContainEqual(
      expect.objectContaining({ field: "geboortedatum", code: "geboortedatum_not_past" }),
    );
  });

  it("rejects today (not strictly in the past)", () => {
    const errors = validatePatientInput(validInput({ geboortedatum: "2026-06-02" }), NOW);
    expect(errors).toContainEqual(
      expect.objectContaining({ field: "geboortedatum", code: "geboortedatum_not_past" }),
    );
  });

  it("rejects a non-existent calendar date", () => {
    const errors = validatePatientInput(validInput({ geboortedatum: "2026-02-30" }), NOW);
    expect(errors).toContainEqual(
      expect.objectContaining({ field: "geboortedatum", code: "geboortedatum_invalid" }),
    );
  });

  it("accepts yesterday", () => {
    expect(validatePatientInput(validInput({ geboortedatum: "2026-06-01" }), NOW)).toEqual([]);
  });
});

describe("multiple errors are collected", () => {
  it("returns every failure at once", () => {
    const errors = validatePatientInput(
      { voornaam: "", achternaam: "", geboortedatum: "", geslacht: "x", bsn: "" },
      NOW,
    );
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });
});
