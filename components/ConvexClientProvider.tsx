"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * A single Convex client instance, reused across renders for the browser
 * session. The build's prerender step is kept from crashing on a missing
 * NEXT_PUBLIC_CONVEX_URL by `export const dynamic = "force-dynamic"` in the
 * root layout — not by this lazy initialization. If that layout export is
 * removed, `next build` will start throwing here during prerender.
 */
let convexClient: ConvexReactClient | undefined;

function getConvexClient(): ConvexReactClient {
  if (!convexUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_CONVEX_URL. Copy .env.example to .env.local and set it (see README / .env.example).",
    );
  }
  if (!convexClient) {
    convexClient = new ConvexReactClient(convexUrl);
  }
  return convexClient;
}

/**
 * Wires Clerk (identity) and Convex (backend) together on the client.
 * Convex receives the Clerk auth state via ConvexProviderWithClerk, so Convex
 * functions can read the authenticated identity with ctx.auth.getUserIdentity().
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={getConvexClient()} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
