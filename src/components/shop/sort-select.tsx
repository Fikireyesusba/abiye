"use client";
import { useTranslations } from "next-intl";
import { SORTS, type Sort } from "@/lib/catalog/search";

/** Native <select> inside a GET form: works without JS, auto-submits with JS. */
export function SortSelect({ value }: { value: Sort }) {
  const t = useTranslations("catalog");
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("sortBy")}</span>
      <select
        name="sort"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`sort_${s}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
