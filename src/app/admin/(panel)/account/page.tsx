import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/guards";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireAdmin();
  return (
    <>
      <PageHeader title="My account" description={`${ctx.fullName} · ${ctx.roleName}`} />
      <Panel title="Change password" className="max-w-lg">
        <PasswordForm />
      </Panel>
    </>
  );
}
