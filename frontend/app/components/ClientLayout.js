"use client";

import { AuthProvider } from "../lib/auth";
import AuthGuard from "./AuthGuard";
import AgentV2Widget from "./agent/AgentV2Widget";

export default function ClientLayout({ children }) {
  return (
    <AuthProvider>
      <AgentV2Widget />
      <AuthGuard>{children}</AuthGuard>
    </AuthProvider>
  );
}
