import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { APP_TIME_ZONE } from "@/lib/datetime";

/**
 * Locale resolution without URL prefixes (routes stay exactly as specified):
 * 1. NEXT_LOCALE cookie (set by the language switcher)
 * 2. Accept-Language header (Amharic speakers get Amharic on first visit)
 * 3. English
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: Locale = defaultLocale;
  if (isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const accept = (await headers()).get("accept-language") ?? "";
    if (/^\s*am\b/i.test(accept)) locale = "am";
  }
  return {
    locale,
    timeZone: APP_TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
