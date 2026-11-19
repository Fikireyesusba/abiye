import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getMfaState } from "@/lib/auth/mfa";
import { safeAdminRedirect } from "@/lib/auth/safe-redirect";
import { MfaSetupForm, MfaVerifyForm } from "./mfa-forms";

export const metadata: Metadata = { title: "Two-step login", robots: { index: false, follow: false } };

export default async function AdminMfaPage({ searchParams }: PageProps<"/admin/mfa">) {
  const next = safeAdminRedirect((await searchParams).next);
  const state = await getMfaState();
  if (!state.userId) redirect("/admin/login");
  if (state.staff && state.verified) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Two-step login</h1>
          <p className="text-sm text-muted-foreground">
            {!state.staff
              ? "This account does not have access to the admin dashboard."
              : state.factorId
                ? "Open your authenticator app and enter the 6-digit code for Abiye Admin."
                : "Admin accounts are protected with a code from an authenticator app. Set it up once — it takes a minute."}
          </p>
        </div>
        {state.staff && (state.factorId ? <MfaVerifyForm next={next} /> : <MfaSetupForm next={next} />)}
        <form action={signOut} className="mt-6 text-center">
          <Button type="submit" variant="ghost" size="sm"><LogOut /> Sign out</Button>
        </form>
      </div>
    </main>
  );
}
