import { getRequestConfig } from "next-intl/server";
import { defaultLocale } from "./config";
import { APP_TIME_ZONE } from "@/lib/datetime";

/** The website is in English only (Amharic was removed on the owner's request, 2026-11-23). */
export default getRequestConfig(async () => ({
  locale: defaultLocale,
  timeZone: APP_TIME_ZONE,
  messages: (await import("../../messages/en.json")).default,
}));
