import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC_PATHS = ['/auth', '/setup', '/api/setup']

function isPublicPath(path: string) {
  return PUBLIC_PATHS.some(p => path.startsWith(p)) || path === '/'
}

// No user possible → apply the same auth gating as a null-user response
function denyUnauthenticated(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (path.startsWith('/workspace')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return NextResponse.redirect(url)
  }
  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  const path = request.nextUrl.pathname
  const hasAuthCookies = request.cookies
    .getAll()
    .some(cookie => cookie.name.startsWith('sb-'))

  // Fast path: no sb-* cookies → no session can exist, so skip creating the
  // Supabase client and skip the getUser() network round-trip (TTFB on `/`)
  if (!hasAuthCookies) {
    if (isPublicPath(path)) {
      return NextResponse.next({ request })
    }
    return denyUnauthenticated(request) ?? NextResponse.next({ request })
  }

  // Create response ONCE — setAll will only call response.cookies.set()
  const supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // IMPORTANT: Always call getUser() — this triggers token refresh
  // and writes refreshed cookies to supabaseResponse via setAll
  const { data: { user } } = await supabase.auth.getUser()

  // Public routes — allow through without auth redirect,
  // but tokens are still refreshed above
  if (!user && !isPublicPath(path)) {
    return denyUnauthenticated(request) ?? supabaseResponse
  }

  // Always return the same supabaseResponse — never create a new one
  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
