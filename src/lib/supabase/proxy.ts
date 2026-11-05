import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isWorkerEndpoint } from "@/features/research/worker/endpoint";
import { getPublicEnv } from "@/lib/env/public";
import type { Database } from "@/types/database";

const PUBLIC_PATHS = ["/login", "/auth", "/setup"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session cookie and performs an optimistic auth redirect.
 * Real authorization happens in the data layer and in RLS, not here.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The research worker is called by a script, not a signed-in browser, and authenticates with
  // its own shared secret inside the route handler. Only this exact path skips the login
  // redirect; every other route (including any path that merely starts with it) is unchanged.
  if (isWorkerEndpoint(pathname)) return NextResponse.next();

  const env = getPublicEnv();

  if (!env) {
    if (pathname.startsWith("/setup")) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between client creation and getClaims(); it revalidates the token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  if (!signedIn && !isPublicPath(pathname)) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}
