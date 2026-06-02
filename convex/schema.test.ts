import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import schema, {
  AFSPRAAK_STATUS_VALUES,
  AUDIT_ACTION_VALUES,
  AUDIT_RESOURCE_TYPE_VALUES,
  BEHANDELING_STATUS_VALUES,
  GESLACHT_VALUES,
} from "./schema";

/**
 * These tests assert the *shape* of the Convex schema (Story F-3-S1) — which
 * fields exist, which are required vs optional, and which enum/reference
 * validators they use — by reading each table's exported validator JSON. They
 * intentionally do NOT spin up a Convex runtime: the live `npx convex dev`
 * deploy + dashboard check (AC-1) is a documented manual step that requires a
 * Convex deployment URL (not available offline). No patient-identifying data is
 * used here (BR-10).
 */

type FieldJson = { optional: boolean; fieldType: { type: string } };

/**
 * The validator JSON and index list are runtime details Convex exposes but does
 * not surface on its public TS types, so we read them through a narrow runtime
 * view. This keeps the test asserting the real serialized schema shape.
 */
interface TableRuntimeView {
  validator: { json: { value: Record<string, FieldJson> } };
  indexes: Array<{ indexDescriptor: string }>;
}

function tableView(table: keyof typeof schema.tables): TableRuntimeView {
  return schema.tables[table] as unknown as TableRuntimeView;
}

function fields(table: keyof typeof schema.tables): Record<string, FieldJson> {
  return tableView(table).validator.json.value;
}

function indexNames(table: keyof typeof schema.tables): string[] {
  return tableView(table).indexes.map((index) => index.indexDescriptor);
}

describe("convex schema — collections", () => {
  it("defines exactly the five FRD collections", () => {
    expect(Object.keys(schema.tables).sort()).toEqual(
      ["afspraak", "audit_log", "behandeling", "behandelsoort", "patient"].sort(),
    );
  });
});

describe("patient", () => {
  const f = fields("patient");

  it("requires the FRD-mandatory fields (non-optional validators)", () => {
    for (const field of ["voornaam", "achternaam", "geboortedatum", "geslacht", "bsn", "actief"]) {
      expect(f[field], field).toBeDefined();
      expect(f[field].optional, `${field} must be required`).toBe(false);
    }
  });

  it("rejects a patient document without bsn (bsn is a required validator)", () => {
    // The schema validator is the gate the FRD AC describes: omitting `bsn`
    // fails validation because the field is non-optional. We assert the
    // validator contract here; the runtime rejection is verified via convex dev.
    expect(f.bsn).toBeDefined();
    expect(f.bsn.optional).toBe(false);
    expect(f.bsn.fieldType.type).toBe("string");
  });

  it("keeps FRD-optional fields optional", () => {
    for (const field of ["tussenvoegsel", "email", "telefoonnummer", "adres", "notities"]) {
      expect(f[field].optional, `${field} must be optional`).toBe(true);
    }
  });

  it("indexes patient by bsn for search and uniqueness lookups", () => {
    expect(indexNames("patient")).toContain("by_bsn");
  });
});

describe("afspraak", () => {
  const f = fields("afspraak");

  it("requires patientId, behandelaarId, startDatetime, durationMinutes, status", () => {
    for (const field of [
      "patientId",
      "behandelaarId",
      "startDatetime",
      "durationMinutes",
      "status",
    ]) {
      expect(f[field], field).toBeDefined();
      expect(f[field].optional, `${field} must be required`).toBe(false);
    }
  });

  it("keeps behandelsoortId an optional reference (BR-12)", () => {
    expect(f.behandelsoortId.optional).toBe(true);
    expect(f.behandelsoortId.fieldType.type).toBe("id");
  });

  it("uses references for patientId and behandelsoortId", () => {
    expect(f.patientId.fieldType.type).toBe("id");
  });
});

describe("behandeling", () => {
  const f = fields("behandeling");

  it("requires patientId, behandelaarId, treatmentDate, behandelsoortId, behandelverslag, status", () => {
    for (const field of [
      "patientId",
      "behandelaarId",
      "treatmentDate",
      "behandelsoortId",
      "behandelverslag",
      "status",
    ]) {
      expect(f[field], field).toBeDefined();
      expect(f[field].optional, `${field} must be required`).toBe(false);
    }
  });

  it("makes behandelsoortId a required reference (BR-12)", () => {
    expect(f.behandelsoortId.optional).toBe(false);
    expect(f.behandelsoortId.fieldType.type).toBe("id");
  });

  it("keeps afspraakId an optional reference", () => {
    expect(f.afspraakId.optional).toBe(true);
    expect(f.afspraakId.fieldType.type).toBe("id");
  });
});

describe("behandelsoort", () => {
  const f = fields("behandelsoort");

  it("requires naam and actief", () => {
    expect(f.naam.optional).toBe(false);
    expect(f.actief.optional).toBe(false);
  });
});

describe("audit_log", () => {
  const f = fields("audit_log");

  it("requires every audit field (FR-20)", () => {
    for (const field of [
      "actorId",
      "actorRole",
      "action",
      "resourceType",
      "resourceId",
      "timestamp",
    ]) {
      expect(f[field], field).toBeDefined();
      expect(f[field].optional, `${field} must be required`).toBe(false);
    }
  });

  it("carries no patient-identifying field — only ids/roles/action/timestamp", () => {
    expect(Object.keys(f).sort()).toEqual(
      ["action", "actorId", "actorRole", "resourceId", "resourceType", "timestamp"].sort(),
    );
  });
});

describe("controlled vocabularies match the FRD", () => {
  it("geslacht (BR-1)", () => {
    expect([...GESLACHT_VALUES]).toEqual(["man", "vrouw", "overig", "onbekend"]);
  });

  it("afspraak status (FR-11)", () => {
    expect([...AFSPRAAK_STATUS_VALUES]).toEqual([
      "gepland",
      "bevestigd",
      "voltooid",
      "geannuleerd",
    ]);
  });

  it("behandeling status", () => {
    expect([...BEHANDELING_STATUS_VALUES]).toEqual(["concept", "definitief"]);
  });

  it("audit action + resourceType (FR-20)", () => {
    expect([...AUDIT_ACTION_VALUES]).toEqual(["create", "edit", "view", "deactivate", "finalize"]);
    expect([...AUDIT_RESOURCE_TYPE_VALUES]).toEqual([
      "patient",
      "afspraak",
      "behandeling",
      "behandelsoort",
    ]);
  });
});

describe("audit_log is append-only (BR-13)", () => {
  // This is a static tripwire, not full enforcement. A mutation receives a
  // document Id (e.g. `row._id`), never the table-name string, so we cannot
  // reliably tell from text whether a given `db.patch/replace/delete` targets
  // audit_log specifically. Instead we rely on encapsulation: the table name
  // "audit_log" is referenced only by the module(s) that read/append the log
  // (the insert-only audit writer arrives with #17); domain mutations go
  // through that writer and never name the table. So the honest, deterministic
  // rule is: any convex source file that references the audit_log table must
  // not contain a patch/replace/delete call at all. That keeps the audit
  // module insert/query-only, and conservatively flags (for human BR-13
  // review) any future file that mixes audit_log access with mutating calls.
  // Authoritative insert-only enforcement is owned by the audit writer in #17.
  it("no convex source that references audit_log performs patch/replace/delete", () => {
    const convexDir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(convexDir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );

    const mutatingCall = /\.(patch|replace|delete)\s*\(/;
    const referencesAuditLog = /\baudit_log\b/;

    const offenders = sources.filter((name) => {
      const content = readFileSync(join(convexDir, name), "utf8");
      return referencesAuditLog.test(content) && mutatingCall.test(content);
    });

    expect(offenders).toEqual([]);
  });

  it("confirms audit.ts is the sole legitimate audit_log referencer and is insert-only (#17)", () => {
    // Insert-only enforcement is owned by the audit writer (#17). Here we pin
    // the encapsulation the tripwire above relies on: aside from schema.ts
    // (which DEFINES the table but performs no data access), exactly the audit
    // writer (audit.ts) names the audit_log table — domain mutations must go
    // through it and never name the table themselves. The writer's own
    // no-patch/replace/delete and insert-only guarantees are asserted in
    // audit.test.ts; this keeps the boundary honest if a future file starts
    // referencing audit_log directly.
    const convexDir = dirname(fileURLToPath(import.meta.url));
    const referencesAuditLog = /\baudit_log\b/;

    const referencers = readdirSync(convexDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "schema.ts")
      .filter((name) => referencesAuditLog.test(readFileSync(join(convexDir, name), "utf8")));

    expect(referencers).toEqual(["audit.ts"]);
  });
});
