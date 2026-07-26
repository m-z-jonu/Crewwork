import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Simple invite token: base64 of workspaceId:email:expiry
// In production, use a signed JWT or database-stored token
function validateInviteToken(token: string): { workspaceId: string; email: string } | null {
  try {
    const decoded = atob(token)
    const [workspaceId, email, expiry] = decoded.split(':')
    if (!workspaceId || !email || !expiry) return null
    if (Date.now() > parseInt(expiry)) return null // Token expired
    return { workspaceId, email }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    const { email, password, workspaceId, inviteToken } = await request.json()

    if (!email || !password || !workspaceId || !inviteToken) {
      return NextResponse.json(
        { error: 'Missing required fields (email, password, workspaceId, inviteToken)' },
        { status: 400 }
      )
    }

    // Validate invite token
    const tokenData = validateInviteToken(inviteToken)
    if (!tokenData || tokenData.workspaceId !== workspaceId || tokenData.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'Invalid or expired invite token' }, { status: 403 })
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Validate workspace exists
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single()

    if (wsError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    let userId: string | null = null

    // Try to create the user
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: email.split('@')[0],
        workspace_id: workspaceId,
      },
    })

    if (newUser?.user) {
      userId = newUser.user.id
    } else if (createError) {
      // User already exists — find them
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })
      const existingUser = usersData?.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      )
      if (!existingUser) {
        return NextResponse.json(
          { error: 'Could not find user account' },
          { status: 404 }
        )
      }
      userId = existingUser.id
    }

    if (!userId) {
      return NextResponse.json({ error: 'Failed to create or find user' }, { status: 500 })
    }

    // Add to workspace if not already a member
    const { data: existing } = await supabaseAdmin
      .from('workspace_members')
      .select('profile_id')
      .eq('workspace_id', workspaceId)
      .eq('profile_id', userId)
      .limit(1)

    if (!existing || existing.length === 0) {
      await supabaseAdmin.from('workspace_members').insert({
        workspace_id: workspaceId,
        profile_id: userId,
        role: 'member',
      })

      // Add to all public channels
      const { data: channels } = await supabaseAdmin
        .from('channels')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('is_private', false)

      if (channels) {
        for (const ch of channels) {
          await supabaseAdmin
            .from('channel_members')
            .insert({ channel_id: ch.id, profile_id: userId })
            .then(() => {})
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[invite-complete] Error:', error)
    return NextResponse.json(
      { error: 'Failed to complete invite' },
      { status: 500 }
    )
  }
}
