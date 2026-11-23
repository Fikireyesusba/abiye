"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

import { THEME_COOKIE, type ThemeChoice } from "@/lib/theme";

function remember(choice: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** "Same as my phone": follows the device's light / dark setting (the server cannot know it). */
export function ThemeSync({ choice }: { choice: ThemeChoice }) {
  useEffect(() => {
    if (choice !== "system") return;
    apply("system");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  return null;
}

/** Light / Dark / Same as my phone — remembered on this device. */
export function ThemePicker({ initial }: { initial: ThemeChoice }) {
  const t = useTranslations("profile");
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const pick = (c: ThemeChoice) => {
    setChoice(c);
    remember(c);
    apply(c);
  };
  const options = [
    { key: "light" as const, label: t("light"), icon: Sun },
    { key: "dark" as const, label: t("dark"), icon: Moon },
    { key: "system" as const, label: t("system"), icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label={t("theme")} className="grid grid-cols-3 gap-2" data-testid="theme-picker">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={choice === o.key} onClick={() => pick(o.key)}
          className={cn("flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs", choice === o.key ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-secondary")}
          data-testid={`theme-${o.key}`}>
          <o.icon className="size-4" aria-hidden /> {o.label}
        </button>
      ))}
    </div>
  );
}
