import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { PasswordChangeForm } from "./password-change-form";

export const metadata: Metadata = { title: "Change password", robots: { index: false, follow: false } };

/** Staff, admins and couriers change their password here (no sign-in needed: email, current password, code). */
export default function StaffPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><KeyRound className="size-6" aria-hidden /></span>
          <h1 className="text-xl font-semibold">Change password</h1>
          <p className="text-sm text-muted-foreground">For staff, admin and courier accounts</p>
        </div>
        <PasswordChangeForm />
      </div>
    </main>
  );
}
