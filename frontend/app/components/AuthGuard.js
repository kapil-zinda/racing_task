"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

// Quiet auth splash: centered brand mark with a subtle pulse (reduced motion is
// collapsed globally). No text unless the check drags on (>2s).
function AuthSplash() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="auth-splash" role="status" aria-label="Signing you in">
      <img className="auth-splash-mark" src="/dias-icon.png" alt="" />
      {slow && <p className="auth-splash-text">Signing you in…</p>}
    </div>
  );
}

export default function AuthGuard({ children }) {
  const { auth, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Signed-out visitors can see the public landing/explainer page (root) and the
  // auth screens; everything else sends them to the landing page first.
  const PUBLIC = ["/", "/about", "/how-to-use", "/contact", "/pricing"];
  const isPublic = PUBLIC.includes(pathname) || pathname.startsWith("/auth");

  useEffect(() => {
    if (!loading && !auth && !isPublic) {
      router.replace("/");
    }
  }, [auth, loading, isPublic, router]);

  if (loading) {
    return <AuthSplash />;
  }

  return children;
}
