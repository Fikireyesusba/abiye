import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getAdminContext } from "@/lib/auth/guards";
import { safeAdminRedirect } from "@/lib/auth/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const next = safeAdminRedirect((await searchParams).next);
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
        <LoginForm next={next} />
      </div>
    </main>
  );
}
