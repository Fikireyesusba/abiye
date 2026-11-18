"use client";
import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/admin/result";
import { cn } from "@/lib/utils";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * Form bound to an admin server action. Shows the result as a toast and inline
 * message; optionally asks for confirmation for destructive actions.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  confirm,
  variant = "default",
  size = "default",
  className,
  resetOnSuccess,
  hidden,
  keepSuccess,
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel: React.ReactNode;
  confirm?: string;
  variant?: "default" | "outline" | "destructive" | "secondary" | "accent";
  size?: "default" | "sm";
  className?: string;
  resetOnSuccess?: boolean;
  hidden?: Record<string, string>;
  /** Keep the success message on screen (e.g. a one-time temporary password). */
  keepSuccess?: boolean;
}) {
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  // The toast is raised from the submit handler (not an effect) so it still shows
  // when a successful action removes this form from the page (e.g. a verified
  // payment leaving the "to verify" list).
  const run = (fd: FormData) =>
    startTransition(async () => {
      const res = await action(state, fd);
      if (!res) return; // the action redirected
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        if (resetOnSuccess) ref.current?.reset();
      } else toast.error(res.error);
      setState(res);
    });

  return (
    <form
      ref={ref}
      className={cn("space-y-3", className)}
      // Submitted manually (not via the `action` prop) so React does NOT reset the
      // form afterwards: on a validation error the admin keeps everything typed.
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        run(new FormData(e.currentTarget));
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {state && !state.ok && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {keepSuccess && state?.ok && state.message && (
        <p role="status" className="rounded-md bg-success/10 p-3 text-sm break-words whitespace-pre-line text-foreground">{state.message}</p>
      )}
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} {submitLabel}
      </Button>
    </form>
  );
}
