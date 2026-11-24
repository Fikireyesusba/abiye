"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markNotificationsRead } from "@/lib/courier/actions";

/** Opening the notifications marks them read (the badge disappears on the next screen). */
export function MarkRead() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => void markNotificationsRead().then(() => router.refresh()), 1500);
    return () => clearTimeout(t);
  }, [router]);
  return null;
}
