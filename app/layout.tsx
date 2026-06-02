import { AppNav } from "@/components/AppNav";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wellness EPD",
  description: "Elektronisch Patiëntendossier voor een wellnesskliniek (POC).",
};

/**
 * The app is auth-gated (Clerk) and backed by a reactive Convex connection, so
 * pages are rendered per-request rather than statically prerendered at build
 * time. This also keeps the production build from requiring live Clerk/Convex
 * credentials just to prerender static pages.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <ConvexClientProvider>
          <AppNav />
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
