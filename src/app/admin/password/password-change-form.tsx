"use client";
import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeStaffPassword, type PasswordChangeState } from "@/lib/auth/password-change";

export function PasswordChangeForm() {
  const [state, action, pending] = useActionState<PasswordChangeState, FormData>(changeStaffPassword, {});
  if (state.done) {
    return (
      <div className="space-y-4 text-center" role="status" data-testid="password-changed">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
        <p className="font-medium">Done — your password has been changed.</p>
        <p className="text-sm text-muted-foreground">You have been signed out on every device. Sign in again with your new password.</p>
        <Button asChild className="w-full"><Link href="/admin/login">Sign in</Link></Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pc-email">Email</Label>
        <Input id="pc-email" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pc-current">Current password</Label>
        <Input id="pc-current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pc-code">6-digit code from your authenticator app</Label>
        <Input id="pc-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required className="font-mono tracking-widest" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pc-new">New password</Label>
        <Input id="pc-new" name="password" type="password" autoComplete="new-password" minLength={12} required aria-describedby="pc-hint" />
        <p id="pc-hint" className="text-xs text-muted-foreground">At least 12 characters, with upper-case, lower-case letters and a number.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pc-confirm">New password again</Label>
        <Input id="pc-confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {state.error && <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} Save changes
      </Button>
      <p className="text-center text-xs text-muted-foreground">Forgot your password? Ask the Super Admin to reset it. <Link href="/admin/login" className="text-primary underline">Back to sign in</Link></p>
    </form>
  );
}
