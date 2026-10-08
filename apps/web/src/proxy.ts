import { NextResponse, type NextRequest } from "next/server"

// Playground mode (FILLRATE_PLAYGROUND=1): only /playground and POST /api/v1/playground exist. Otherwise /playground is hidden.
const stored = /^\/(scenarios|runs|experiments|explore)(\/|$)/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const playground = process.env.FILLRATE_PLAYGROUND === "1"
  if (pathname.startsWith("/api/")) {
    if (playground && pathname !== "/api/v1/playground") return NextResponse.json({ error: { code: "not_found", message: "Not available in playground mode." } }, { status: 404 })
    return NextResponse.next()
  }
  if (playground && stored.test(pathname)) return NextResponse.redirect(new URL("/playground", request.url))
  if (!playground && (pathname === "/playground" || pathname.startsWith("/playground/"))) return NextResponse.redirect(new URL("/scenarios", request.url))
  return NextResponse.next()
}

export const config = {
  matcher: ["/scenarios/:path*", "/runs/:path*", "/experiments/:path*", "/explore/:path*", "/playground/:path*", "/api/v1/:path*"],
}
