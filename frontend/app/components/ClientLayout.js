"use client";

import { AuthProvider } from "../lib/auth";
import AuthGuard from "./AuthGuard";

export default function ClientLayout({ children }) {
  return (
    <AuthProvider>
      <AuthGuard>{children}</AuthGuard>
    </AuthProvider>
  );
}
