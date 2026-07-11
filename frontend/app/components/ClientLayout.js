"use client";

import "./shared.css";
import { AuthProvider } from "../lib/auth";
import { CreditsProvider } from "../lib/credits";
import { ThemeSync } from "../lib/theme";
import AuthGuard from "./AuthGuard";
import DialogHost from "./DialogHost";
import CreditGuard from "./CreditGuard";
import KeyboardShortcuts from "./KeyboardShortcuts";

export default function ClientLayout({ children }) {
  return (
    <AuthProvider>
      <CreditsProvider>
        <ThemeSync />
        <AuthGuard>{children}</AuthGuard>
        <DialogHost />
        <CreditGuard />
        <KeyboardShortcuts />
      </CreditsProvider>
    </AuthProvider>
  );
}
