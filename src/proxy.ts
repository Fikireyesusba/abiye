import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

/** Paths that read the Supabase session (cookie refresh needed). */
const SESSION_PATHS = [/^\/admin(\/|$)/, /^\/account(\/|$)/, /^\/checkout$/, /^\/order-success\//, /^\/printing(\/|$)/];

/**
 * Runs before every page:
 *   1. Content-Security-Policy with a fresh nonce per request. Next.js reads
 *      the nonce from the request's CSP header and adds it to its own scripts.
 *   2. Session pages: refreshes the Supabase session cookie (required by
 *      @supabase/ssr) so server components always see a valid session.
 *   3. /admin only: bounces unauthenticated visitors to /admin/login early.
 *
 * Step 3 is a convenience gate, NOT the security boundary. Every admin page,
 * server action and route handler re-checks auth + permissions server-side
 * (src/lib/auth/guards.ts), and the database enforces RLS.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAdmin = /^\/admin(\/|$)/.test(path);
  const isLogin = path === "/admin/login";
  const needsSession = SESSION_PATHS.some((re) => re.test(path));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy({ nonce, supabaseUrl: url, dev: process.env.NODE_ENV === "development" });

  const cookiesToSet: { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }[] = [];
  const extraHeaders: Record<string, string> = {};
  let signedIn = false;
  if (needsSession && url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list, headers) {
          // Updating request.cookies also updates the request's Cookie header (forwarded below).
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.push(...list);
          Object.assign(extraHeaders, headers ?? {});
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
  }

  const finish = (response: NextResponse) => {
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    Object.entries(extraHeaders).forEach(([k, v]) => response.headers.set(k, v));
    response.headers.set("Content-Security-Policy", csp);
    if (needsSession) response.headers.set("Cache-Control", "private, no-store");
    if (isAdmin) response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  };

  // Admin: fail closed when misconfigured; bounce signed-out visitors to the login page.
  if (isAdmin && !isLogin && (!url || !key || !signedIn)) {
    const login = new URL("/admin/login", request.url);
    if (url && key) login.searchParams.set("next", path);
    return finish(NextResponse.redirect(login));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return finish(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    {
      // Every page; not API routes, build assets, image optimizer or static files.
      source: "/((?!api/|_next/static|_next/image|favicon\\.ico|icon|apple-icon|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml|webmanifest)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
