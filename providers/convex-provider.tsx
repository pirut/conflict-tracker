"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://hallowed-spaniel-336.convex.cloud";
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convexClient) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="max-w-lg rounded-2xl border border-amber-400/40 bg-slate-900/70 p-6 text-sm">
          <p className="font-semibold text-amber-300">Missing NEXT_PUBLIC_CONVEX_URL</p>
          <p className="mt-2 text-slate-300">
            Add your Convex deployment URL to <code>.env.local</code> and restart <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
