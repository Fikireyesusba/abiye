"use client";
import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestPasswordReset, resendConfirmation, setNewPassword, signInCustomer, signUpCustomer, updateCustomerAccount,
  type AccountState,
} from "@/lib/account/actions";

type Action = (prev: AccountState, fd: FormData) => Promise<AccountState>;

function useForm(action: Action) {
  return useActionState<AccountState, FormData>(action, {});
}

function ErrorMsg({ state }: { state: AccountState }) {
  const t = useTranslations("account.errors");
  return state.error ? <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">{t(state.error)}</p> : null;
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />} {children}
    </Button>
  );
}

function CheckEmail({ email }: { email: string }) {
  const t = useTranslations("account");
  const [state, action, pending] = useForm(resendConfirmation);
  return (
    <div className="space-y-4 text-center" role="status">
      <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
      <h2 className="text-lg font-semibold">{t("checkEmailTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("checkEmail", { email })}</p>
      <form action={action}>
        <input type="hidden" name="email" value={email} />
        <Button type="submit" variant="link" disabled={pending}>{t("resend")}</Button>
      </form>
      {state.ok && <p className="text-xs text-success">✓</p>}
      <ErrorMsg state={state} />
    </div>
  );
}

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("account");
  const [state, action, pending] = useForm(signInCustomer);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link href="/account/forgot-password" className="text-xs text-primary hover:underline">{t("forgot")}</Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <ErrorMsg state={state} />
        <Submit pending={pending}>{t("signIn")}</Submit>
      </form>
      {state.error === "notConfirmed" && state.email && <CheckEmail email={state.email} />}
      <p className="text-center text-sm text-muted-foreground">
        {t("noAccount")} <Link href={`/account/signup?next=${encodeURIComponent(next)}`} className="font-medium text-primary hover:underline">{t("signUp")}</Link>
      </p>
    </div>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const t = useTranslations("account");
  const [state, action, pending] = useForm(signUpCustomer);
  if (state.ok === "checkEmail" && state.email) return <CheckEmail email={state.email} />;
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">{t("fullName")}</Label>
          <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} defaultValue={state.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-describedby="pw-hint" />
          <p id="pw-hint" className="text-xs text-muted-foreground">{t("passwordHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t("confirmPassword")}</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptTerms" required className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
          <span>
            {t.rich("acceptTerms", {
              terms: (c) => <Link href="/terms" target="_blank" className="underline">{c}</Link>,
              privacy: (c) => <Link href="/privacy" target="_blank" className="underline">{c}</Link>,
            })}
          </span>
        </label>
        <ErrorMsg state={state} />
        <Submit pending={pending}>{t("signUp")}</Submit>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")} <Link href={`/account/login?next=${encodeURIComponent(next)}`} className="font-medium text-primary hover:underline">{t("signIn")}</Link>
      </p>
    </div>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("account");
  const [state, action, pending] = useForm(requestPasswordReset);
  if (state.ok === "resetSent") return <p role="status" className="rounded-md bg-success/10 p-4 text-sm">{t("resetSent", { email: state.email ?? "" })}</p>;
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("forgotIntro")}</p>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
      </div>
      <ErrorMsg state={state} />
      <Submit pending={pending}>{t("sendReset")}</Submit>
    </form>
  );
}

export function ResetPasswordForm() {
  const t = useTranslations("account");
  const [state, action, pending] = useForm(setNewPassword);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("confirmPassword")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <ErrorMsg state={state} />
      {state.error === "linkExpired" && <Link href="/account/forgot-password" className="block text-sm text-primary underline">{t("sendReset")}</Link>}
      <Submit pending={pending}>{t("setPassword")}</Submit>
    </form>
  );
}

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const t = useTranslations("account");
  const [state, action, pending] = useForm(updateCustomerAccount);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">{t("fullName")}</Label>
          <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} defaultValue={fullName} key={`n-${fullName}`} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} defaultValue={phone} key={`p-${phone}`} />
        </div>
      </div>
      <ErrorMsg state={state} />
      {state.ok === "saved" && <p role="status" className="text-sm text-success">{t("saved")}</p>}
      <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {t("save")}</Button>
    </form>
  );
}
