import { defineSchema } from "convex/server";

/**
 * Convex data model — single source of truth for the database.
 *
 * The schema is intentionally empty at scaffold time (Story F-1-S1). Domain
 * tables (patient, afspraak, behandeling) are introduced by their respective
 * feature stories. Keep all table definitions here; never bypass Convex to
 * mutate data.
 */
export default defineSchema({});
