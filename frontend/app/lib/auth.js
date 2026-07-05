"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const STORAGE_KEY = "race_hub_auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const validate = async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) { setLoading(false); return; }
        const session = JSON.parse(raw);
        if (!session?.apiKey) { setLoading(false); return; }
        if (API_BASE_URL) {
          const res = await fetch(`${API_BASE_URL}/user/me`, {
            headers: { "X-API-Key": session.apiKey },
          });
          if (res.ok) {
            setAuth(session);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        } else {
          setAuth(session);
        }
      } catch (_) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) setAuth(JSON.parse(raw));
        } catch (__) {}
      }
      setLoading(false);
    };
    validate();
  }, []);

  const signIn = useCallback((data) => {
    const session = {
      userId: data.user_id,
      name: data.name,
      email: data.email,
      apiKey: data.api_key,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setAuth(session);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuth(null);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useRequireAuth() {
  const { auth, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !auth) {
      router.replace("/auth/signin");
    }
  }, [auth, loading, router]);
  return { auth, loading };
}

export function getAuthHeaders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const session = JSON.parse(raw);
    return session?.apiKey ? { "X-API-Key": session.apiKey } : {};
  } catch (_) {
    return {};
  }
}

export async function apiSignup({ email, name, phone, password }) {
  const res = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, phone, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Signup failed");
  return data;
}

export async function apiVerifyOtp({ email, otp }) {
  const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "OTP verification failed");
  return data;
}

export async function apiResendOtp({ email }) {
  const res = await fetch(`${API_BASE_URL}/auth/resend-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Resend failed");
  return data;
}

export function readAuthUserId() {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const session = JSON.parse(raw);
    return session?.userId || "";
  } catch (_) {
    return "";
  }
}

export async function apiFetch(url, opts = {}) {
  const headers = { ...getAuthHeaders(), ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  // Any 402 (insufficient credits) surfaces a global "add credits" prompt, regardless
  // of which feature made the call. Callers still get the response to handle normally.
  if (res.status === 402 && typeof window !== "undefined") {
    try {
      const body = await res.clone().json();
      window.dispatchEvent(new CustomEvent("insufficient-credits", { detail: body?.detail || {} }));
    } catch (_) {
      window.dispatchEvent(new CustomEvent("insufficient-credits", { detail: {} }));
    }
  }
  return res;
}

export async function apiSignin({ email, password }) {
  const res = await fetch(`${API_BASE_URL}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Signin failed");
  return data;
}
