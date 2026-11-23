import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ServiceWorkerRegister } from "@/components/pwa/pwa";
import { ThemeSync } from "@/components/theme/theme";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Abiye", template: "%s · Abiye" },
  description: "Cosmetics, electronics and printing services in Ethiopia.",
  // Installed app (iPhone "Add to Home Screen"; Android uses app/manifest.ts).
  appleWebApp: { capable: true, title: "Abiye", statusBarStyle: "default" },
  icons: {
    apple: "/app-icon/180",
    icon: [
      { url: "/app-icon/32", sizes: "32x32", type: "image/png" },
      { url: "/app-icon/192", sizes: "192x192", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#14523f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // Light / dark theme chosen on the Profile page (remembered on the device).
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} className={`${inter.variable} h-full${theme === "dark" ? " dark" : ""}`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          {children}
          <ServiceWorkerRegister />
          <ThemeSync choice={theme} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
