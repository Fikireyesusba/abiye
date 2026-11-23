import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { IDLE_MINUTES } from "@/lib/security/idle";
import { getAdminContext } from "@/lib/auth/guards";
import { safeAdminRedirect } from "@/lib/auth/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const sp = await searchParams;
  const next = safeAdminRedirect(sp.next);
  if (await getAdminContext()) redirect(next);
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Abiye Admin</h1>
          <p className="text-sm text-muted-foreground">Staff sign in</p>
        </div>
        {sp.reason === "elsewhere" && <p className="mb-4 rounded-md bg-muted p-3 text-sm" role="status">You were signed out because this account signed in on another device or browser. Only one device can be signed in at a time.</p>}
        {sp.reason === "address" && <p className="mb-4 rounded-md bg-muted p-3 text-sm" role="status">This account signs in at a different address. Please use the sign-in address you were given.</p>}
        {sp.reason === "idle" && <p className="mb-4 rounded-md bg-muted p-3 text-sm" role="status">For security you were signed out after {IDLE_MINUTES.admin} minutes of inactivity. Please sign in again.</p>}
        <LoginForm next={next} />
      </div>
    </main>
  );
}
