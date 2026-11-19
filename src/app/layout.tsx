import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ServiceWorkerRegister } from "@/components/pwa/pwa";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const ethiopic = Noto_Sans_Ethiopic({
  variable: "--font-ethiopic",
  subsets: ["ethiopic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Abiye", template: "%s · Abiye" },
  description: "Cosmetics, electronics and printing services in Ethiopia.",
  // Installed app (iPhone "Add to Home Screen"; Android uses app/manifest.ts).
  appleWebApp: { capable: true, title: "Abiye", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png", icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
};

export const viewport: Viewport = {
  themeColor: "#14523f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${ethiopic.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          {children}
          <ServiceWorkerRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
