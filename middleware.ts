import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from 'next/server';

const isSignInPage = createRouteMatcher(["/signin"]);
const isProtectedRoute = createRouteMatcher(["/product(.*)"]);
const isProfileRoute = createRouteMatcher(["/@:username"]);
const isLegacyProfileRoute = createRouteMatcher(["/user/@:username"]);

// Helper to normalize username for internal routing
const normalizeUsername = (username: string) => {
  // Remove @ if it exists, then add it back for consistency
  return '@' + username.replace(/^@/, '');
};

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Redirect legacy /user/@username to /@username
  if (isLegacyProfileRoute(request)) {
    const url = request.nextUrl.clone();
    // Extract username part and normalize it
    const username = url.pathname.replace('/user/', '');
    url.pathname = normalizeUsername(username);
    return NextResponse.redirect(new URL(url.pathname, request.url), 301);
  }

  // Handle /@username routes
  if (isProfileRoute(request)) {
    const url = request.nextUrl.clone();
    // For internal routing, we keep the normalized version
    const username = url.pathname.substring(1); // remove leading slash
    url.pathname = `/user/${normalizeUsername(username)}`;
    return NextResponse.rewrite(url);
  }

  // Handle existing auth logic
  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
