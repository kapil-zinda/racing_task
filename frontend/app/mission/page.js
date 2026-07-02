"use client";
// Legacy journey route — superseded by the Goal OS at /goals. Redirects there.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyMissionPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/goals"); }, [router]);
  return null;
}
