import { siFacebook, siGmail, siInstagram, siTelegram, siTiktok, siWhatsapp, type SimpleIcon } from "simple-icons";
import { Phone } from "lucide-react";
import type { SiteSettings } from "@/lib/catalog/settings";
import { formatEthiopianPhone, normalizeEthiopianPhone } from "@/lib/validation/phone";
import { cn } from "@/lib/utils";

/** "@handle" from a profile URL (instagram.com/x, tiktok.com/@x, facebook.com/x, t.me/x), else the network name. */
export function handleFromUrl(url: string, fallback: string): string {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "");
    return seg && /^[A-Za-z0-9._]{2,64}$/.test(seg) && !/\.php$/.test(seg) ? `@${seg}` : fallback;
  } catch {
    return fallback;
  }
}

function Brand({ icon, className }: { icon: SimpleIcon; className?: string }) {
  return (
    <svg role="img" viewBox="0 0 24 24" aria-hidden className={cn("size-5 fill-current", className)}>
      <path d={icon.path} />
    </svg>
  );
}

export interface SocialLink {
  key: string;
  label: string;
  href: string;
  display: string;
  icon: React.ReactNode;
  external: boolean;
}

/** All admin-managed ways to reach the business, in display order (only those that are set). */
export function socialLinks(s: SiteSettings): SocialLink[] {
  const out: SocialLink[] = [];
  const phone = normalizeEthiopianPhone(s.contact.phone);
  if (phone) out.push({ key: "phone", label: "Phone", href: `tel:${phone}`, display: formatEthiopianPhone(phone), icon: <Phone className="size-5" />, external: false });
  if (s.contact.email) out.push({ key: "email", label: "Email", href: `mailto:${s.contact.email}`, display: s.contact.email, icon: <Brand icon={siGmail} />, external: false });
  const wa = s.contact.whatsapp ? normalizeEthiopianPhone(s.contact.whatsapp) : null;
  if (wa) out.push({ key: "whatsapp", label: "WhatsApp", href: `https://wa.me/${wa.slice(1)}`, display: formatEthiopianPhone(wa), icon: <Brand icon={siWhatsapp} />, external: true });
  const handle = s.contact.telegram?.replace(/^@/, "");
  const telegramUrl = s.social.telegram ?? (handle && /^[A-Za-z0-9_]{5,32}$/.test(handle) ? `https://t.me/${handle}` : null);
  if (telegramUrl) out.push({ key: "telegram", label: "Telegram", href: telegramUrl, display: handle ? `@${handle}` : handleFromUrl(telegramUrl, "Telegram"), icon: <Brand icon={siTelegram} />, external: true });
  const brands: [keyof SiteSettings["social"], string, SimpleIcon][] = [
    ["instagram", "Instagram", siInstagram],
    ["tiktok", "TikTok", siTiktok],
    ["facebook", "Facebook", siFacebook],
  ];
  for (const [k, label, icon] of brands) {
    const url = s.social[k];
    if (url) out.push({ key: k, label, href: url, display: handleFromUrl(url, label), icon: <Brand icon={icon} />, external: true });
  }
  return out;
}

/** Row of round icon buttons (footer). */
export function SocialIconRow({ links, className }: { links: SocialLink[]; className?: string }) {
  if (!links.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {links.map((l) => (
        <li key={l.key}>
          <a href={l.href} aria-label={`${l.label}: ${l.display}`} title={l.label}
            className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
            {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {l.icon}
          </a>
        </li>
      ))}
    </ul>
  );
}
