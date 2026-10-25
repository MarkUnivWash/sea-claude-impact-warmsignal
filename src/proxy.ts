import { NextResponse, type NextRequest } from "next/server";

// Minimal shared-password gate (HTTP Basic auth) for the deployed demo.
// Contact notes are private: set APP_PASSWORD on Vercel. Unset = no gate (local dev).
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const supplied = atob(encoded).split(":").slice(1).join(":");
    if (supplied === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="WarmSignal"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
