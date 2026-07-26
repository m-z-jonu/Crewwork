import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const query = request.nextUrl.searchParams.get('q') || ''
    // SECURITY: Sanitize query to prevent PostgREST filter injection
    const sanitizedQuery = query.replace(/[^a-zA-Z0-9@.\s_-]/g, '')
    if (sanitizedQuery.length < 2) {
      return NextResponse.json({ users: [] })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Don't select discoverable column — it may not exist yet in the database
    // Filter non-discoverable users in the app layer after the column is added
    const { data: users, error: searchError } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, email, avatar_url, is_online')
      .neq('id', user.id)
      .or(`display_name.ilike.%${sanitizedQuery}%,email.ilike.%${sanitizedQuery}%`)
      .limit(20)

    if (searchError) {
      return NextResponse.json({ error: searchError.message }, { status: 500 })
    }

    return NextResponse.json({ users: users || [] })
  } catch (error) {
    console.error('User search error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
