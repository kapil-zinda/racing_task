"use client";

import { AuthProvider } from "../lib/auth";
import AuthGuard from "./AuthGuard";
import DialogHost from "./DialogHost";

export default function ClientLayout({ children }) {
  return (
    <AuthProvider>
      <AuthGuard>{children}</AuthGuard>
      <DialogHost />
    </AuthProvider>
  );
}
