import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import type { PatientInput } from "../lib/patient-validation";
import type { Role } from "./auth";
import {
  PatientCreationError,
  buildPatientDocument,
  canOverrideDuplicate,
  resolvePatientCreation,
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
