import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { chatWithAgent } from '@/lib/ai/agent'

const AI_AGENT_ID = process.env.AI_AGENT_ID ?? '00000000-0000-0000-0000-000000000000'

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const deepseekKey = process.env.DEEPSEEK_API_KEY

  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  if (!deepseekKey) {
    return NextResponse.json({ error: 'AI agent not configured (missing DEEPSEEK_API_KEY)' }, { status: 500 })
  }

  // Verify authentication
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabaseAuth = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { message, channelId } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    if (message.length > 10000) {
      return NextResponse.json({ error: 'Message too long (max 10000 chars)' }, { status: 400 })
    }

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 })
    }

    // Verify user has access to this channel
    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    })

    const { data: membership } = await supabaseAdmin
      .from('channel_members')
      .select('channel_id')
      .eq('channel_id', channelId)
      .eq('profile_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this channel' }, { status: 403 })
    }

    // Get workspace_id from channel
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('workspace_id')
      .eq('id', channelId)
      .single()

    // Call the AI agent
    const response = await chatWithAgent({
      userId: user.id,
      channelId,
      message: message.trim(),
      workspaceId: channel?.workspace_id,
    })

    // Save the AI response to Supabase messages table
    // (so other clients see it via realtime subscriptions)
    const msgId = crypto.randomUUID()
    const now = new Date().toISOString()

    const { error: insertError } = await supabaseAdmin
      .from('messages')
      .insert({
        id: msgId,
        channel_id: channelId,
        sender_id: AI_AGENT_ID,
        content: response.reply,
        created_at: now,
        updated_at: now,
        is_deleted: false,
        metadata: response.toolCalls ? JSON.stringify({ tool_calls: response.toolCalls }) : null,
      })

    if (insertError) {
      console.error('Failed to save AI message:', insertError)
      // Still return the reply to the user even if DB save fails
    }

    return NextResponse.json({
      reply: response.reply,
      messageId: msgId,
      toolCalls: response.toolCalls,
    })
  } catch (error) {
    console.error('AI chat error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI processing failed' },
      { status: 500 }
    )
  }
}
