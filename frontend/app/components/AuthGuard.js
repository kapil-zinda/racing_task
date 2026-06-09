"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export default function AuthGuard({ children }) {
  const { auth, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !auth && !pathname.startsWith("/auth")) {
      router.replace("/auth/signin");
    }
  }, [auth, loading, pathname, router]);

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
