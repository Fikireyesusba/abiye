"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useTranslations("order");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers / insecure contexts: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label ? `${t("copy")} ${label}` : t("copy")}>
      {copied ? <Check className="text-success" /> : <Copy />}
      <span aria-live="polite">{copied ? t("copied") : t("copy")}</span>
    </Button>
  );
}
