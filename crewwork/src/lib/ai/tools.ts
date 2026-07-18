import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * Tool: Search messages in a channel.
 */
export const searchChannelMessages = tool(
  async ({ channelId, query, limit }) => {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, content, sender_id, created_at')
      .eq('channel_id', channelId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit ?? 20)

    if (error) return `Error: ${error.message}`

    const filtered = (messages ?? []).filter(m =>
      m.content.toLowerCase().includes(query.toLowerCase())
    )

    if (filtered.length === 0) return 'No messages found matching the query.'

    return filtered
      .map(m => `[${m.created_at}] ${m.content}`)
      .join('\n')
  },
  {
    name: 'search_channel_messages',
    description: 'Search for messages in a channel by text content. Returns matching messages with timestamps.',
    schema: z.object({
      channelId: z.string().describe('The channel ID to search in'),
      query: z.string().describe('Text to search for'),
      limit: z.number().optional().default(20).describe('Max messages to return'),
    }),
  }
)

/**
 * Tool: Get channel list.
 */
export const getChannels = tool(
  async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { data, error } = await supabase
      .from('channels')
      .select('id, name, description')
      .eq('is_archived', false)
      .order('name')

    if (error) return `Error: ${error.message}`
    return (data ?? []).map(c => `${c.name} (${c.id}): ${c.description || 'No description'}`).join('\n')
  },
  {
    name: 'get_channels',
    description: 'List all channels in the workspace.',
    schema: z.object({}),
  }
)

/**
 * Tool: Get user profile info.
 */
export const getUserProfile = tool(
  async ({ userId }) => {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, email, status_text, status_emoji, is_online')
      .eq('id', userId)
      .single()

    if (error) return `Error: ${error.message}`
    return JSON.stringify(data)
  },
  {
    name: 'get_user_profile',
    description: 'Get a user profile by their ID.',
    schema: z.object({
      userId: z.string().describe('The user UUID'),
    }),
  }
)

/**
 * Tool: Get recent todos.
 */
export const getTodos = tool(
  async ({ workspaceId, status }) => {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    let query = supabase
      .from('todos')
      .select('id, title, description, status, priority, assigned_to, due_date')
      .eq('workspace_id', workspaceId)
      .order('position')

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) return `Error: ${error.message}`
    return (data ?? []).map(t =>
      `[${t.status}] ${t.title} (priority: ${t.priority}, due: ${t.due_date ?? 'none'})`
    ).join('\n') || 'No todos found.'
  },
  {
    name: 'get_todos',
    description: 'Get todos for a workspace, optionally filtered by status.',
    schema: z.object({
      workspaceId: z.string().describe('Workspace UUID'),
      status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional().describe('Filter by status'),
    }),
  }
)

/**
 * Tool: Save a user preference or fact to memory.
 * Factory that captures userId from the agent state.
 */
export function createSaveUserMemoryTool(userId: string) {
  return tool(
    async ({ key, value }) => {
      const { setMemory } = await import('./memory')
      await setMemory(userId, key, value)
      return `Saved: ${key} = ${value}`
    },
    {
      name: 'save_user_memory',
      description: 'Remember a preference or fact about the user for future conversations.',
      schema: z.object({
        key: z.string().describe('Memory key (e.g., "preferred_language", "role")'),
        value: z.string().describe('Value to remember'),
      }),
    }
  )
}

export const AI_TOOLS = [
  searchChannelMessages,
  getChannels,
  getUserProfile,
  getTodos,
]
