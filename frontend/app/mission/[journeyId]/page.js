"use client";
// Legacy journey detail route — superseded by the Goal OS at /goals. Redirects there.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyJourneyDetailPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/goals"); }, [router]);
  return null;
}
