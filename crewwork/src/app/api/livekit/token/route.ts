import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AccessToken } from 'livekit-server-sdk'

export async function POST(request: NextRequest) {
  try {
    const { roomName, workspaceId, channelId } = await request.json()

    if (!roomName || !workspaceId || !channelId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const livekitApiKey = process.env.LIVEKIT_API_KEY
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET
    const livekitUrl = process.env.LIVEKIT_URL

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
      return NextResponse.json(
        { error: 'LiveKit not configured. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL in .env.local' },
        { status: 500 }
      )
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    // Use service role key to bypass RLS for channel/workspace lookups
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Service role key not configured' }, { status: 500 })
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: ws, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('calls_enabled')
      .eq('id', workspaceId)
      .single()

    if (wsError || !ws) {
      return NextResponse.json(
        { error: 'Workspace not found.' },
        { status: 400 }
      )
    }

    if (!ws.calls_enabled) {
      return NextResponse.json({ error: 'Calls are disabled for this workspace' }, { status: 400 })
    }

    // Check channel-level calls_enabled
    const { data: ch, error: chError } = await supabaseAdmin
      .from('channels')
      .select('calls_enabled')
      .eq('id', channelId)
      .single()

    if (chError || !ch) {
      return NextResponse.json(
        { error: 'Channel not found.' },
        { status: 400 }
      )
    }

    if (!ch.calls_enabled) {
      return NextResponse.json({ error: 'Calls are disabled for this channel' }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single()

    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: user.id,
      name: profile?.display_name || user.email || 'User',
      ttl: '10m',
    })

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    })

    const participantToken = await at.toJwt()

    return NextResponse.json({
      server_url: livekitUrl,
      participant_token: participantToken,
    })
  } catch (error) {
    console.error('LiveKit token error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate token' },
      { status: 500 }
    )
  }
}
