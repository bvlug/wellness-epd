/**
 * Clerk <-> Convex authentication configuration.
 *
 * Convex trusts JWTs issued by Clerk's "convex" JWT template. The issuer domain
 * is supplied via the CLERK_JWT_ISSUER_DOMAIN environment variable, configured
 * on the Convex deployment (see .env.example and `npx convex env set`).
 *
 * Convex functions read the caller identity with `ctx.auth.getUserIdentity()`
 * and must authorize on it before returning patient data.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
