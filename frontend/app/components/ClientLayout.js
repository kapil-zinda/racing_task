"use client";

import { AuthProvider } from "../lib/auth";
import { CreditsProvider } from "../lib/credits";
import AuthGuard from "./AuthGuard";
import DialogHost from "./DialogHost";
import CreditGuard from "./CreditGuard";
import KeyboardShortcuts from "./KeyboardShortcuts";

export default function ClientLayout({ children }) {
  return (
    <AuthProvider>
      <CreditsProvider>
        <AuthGuard>{children}</AuthGuard>
        <DialogHost />
        <CreditGuard />
        <KeyboardShortcuts />
      </CreditsProvider>
    </AuthProvider>
  );
}
