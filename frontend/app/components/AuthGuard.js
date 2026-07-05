"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export default function AuthGuard({ children }) {
  const { auth, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Signed-out visitors can see the public landing/explainer page (root) and the
  // auth screens; everything else sends them to the landing page first.
  const isPublic = pathname === "/" || pathname.startsWith("/auth");

  useEffect(() => {
    if (!loading && !auth && !isPublic) {
      router.replace("/");
    }
  }, [auth, loading, isPublic, router]);

  if (loading) {
    return (
      <div style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        color: "#d1d5ff",
        fontSize: 16,
        letterSpacing: "0.04em",
      }}>
        Authenticating…
      </div>
    );
  }

  return children;
}