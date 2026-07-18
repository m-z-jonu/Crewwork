# CrewWork AI Personal Agent — Phase 1: Basic AI Chat

## Overview

Add an AI assistant ("CrewWork AI") that users can chat with 1:1 via a dedicated DM channel and that can participate in group channels. The agent uses LangChain.js + LangGraph.js for orchestration, DeepSeek API as the LLM backend, and local IndexedDB (Dexie) for conversation memory.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Dependencies](#2-dependencies)
3. [Environment Variables](#3-environment-variables)
4. [File-by-File Implementation](#4-file-by-file-implementation)
5. [Database Changes](#5-database-changes)
6. [Integration Points](#6-integration-points)
7. [Testing Strategy](#7-testing-strategy)

---

## 1. Architecture

```
User types message
        │
        ▼
┌─────────────────────┐
│  AI Chat UI         │  src/components/ai/ai-chat.tsx
│  (Message Input)    │
└────────┬────────────┘
         │ POST /api/ai/chat
         ▼
┌─────────────────────┐
│  API Route          │  src/app/api/ai/chat/route.ts
│  (auth + dispatch)  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  LangGraph Agent    │  src/lib/ai/agent.ts
│  (stateful graph)   │
│  ┌────────────────┐ │
│  │ Memory System  │ │  src/lib/ai/memory.ts
│  │ (Dexie + Supa) │ │
│  └────────────────┘ │
│  ┌────────────────┐ │
│  │ Tools          │ │  src/lib/ai/tools.ts
│  │ (read channel, │ │
│  │  search, etc.) │ │
│  └────────────────┘ │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  DeepSeek API       │  src/lib/ai/llm.ts
│  (LLM calls)        │
└─────────────────────┘
```

**Key design decisions:**
- AI agent sends messages as a special `sender_id` (the AI profile UUID, stored in env or hardcoded)
- AI messages bypass E2EE (server-side only, stored as plaintext in Supabase)
- Memory is per-user: each user has their own conversation history with the AI
- LangGraph provides checkpointing so multi-turn conversations are stateful

---

## 2. Dependencies

Install these packages:

```bash
npm install langchain @langchain/core @langchain/community langgraph dexie
```

| Package | Purpose |
|---------|---------|
| `langchain` | Core LangChain.js (chains, prompts, output parsers) |
| `@langchain/core` | Base abstractions (BaseLanguageModel, BaseTool) |
| `@langchain/community` | Community integrations (none needed for DeepSeek — use ChatOpenAI with custom base URL) |
| `langgraph` | Stateful graph-based agent execution with persistence |

**No separate DeepSeek SDK needed** — DeepSeek is OpenAI-compatible. Use `ChatOpenAI` with `configuration.baseURL = 'https://api.deepseek.com'`.

---

## 3. Environment Variables

Add to `.env.local`:

```env
# AI Agent Configuration
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_MODEL_CHAT=deepseek-chat
DEEPSEEK_MODEL_REASON=deepseek-reasoner
AI_AGENT_ID=00000000-0000-0000-0000-000000000000
```

- `DEEPSEEK_API_KEY` — DeepSeek API key
- `DEEPSEEK_MODEL_CHAT` — Default: `deepseek-chat` (deepseek-v4-flash equivalent, cheap/fast)
- `DEEPSEEK_MODEL_REASON` — Default: `deepseek-reasoner` (deepseek-v4-pro equivalent, for complex tasks)
- `AI_AGENT_ID` — UUID for the AI bot profile in the `profiles` table

---

## 4. File-by-File Implementation

### 4.1 `src/lib/ai/llm.ts` — DeepSeek LLM Integration

```typescript
import { ChatOpenAI } from '@langchain/openai'

/**
 * Create a DeepSeek chat model (OpenAI-compatible API).
 */
export function createChatModel(options?: {
  model?: string
  temperature?: number
  maxTokens?: number
}): ChatOpenAI {
  const model = options?.model ?? process.env.DEEPSEEK_MODEL_CHAT ?? 'deepseek-chat'

  return new ChatOpenAI({
    modelName: model,
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens ?? 2048,
    configuration: {
      baseURL: 'https://api.deepseek.com',
    },
    apiKey: process.env.DEEPSEEK_API_KEY,
  })
}

/**
 * Create a reasoning model for complex tasks.
 */
export function createReasoningModel(): ChatOpenAI {
  return createChatModel({
    model: process.env.DEEPSEEK_MODEL_REASON ?? 'deepseek-reasoner',
    temperature: 0.3,
    maxTokens: 4096,
  })
}
```

**Notes:**
- DeepSeek uses OpenAI-compatible API format, so `ChatOpenAI` works directly
- Two model tiers: fast chat (default) and reasoning (for complex queries)
- No streaming in Phase 1 — return full response. Streaming can be added in Phase 2 via `stream: true`

---

### 4.2 `src/lib/ai/memory.ts` — Conversation Memory System

```typescript
import Dexie, { type EntityTable } from 'dexie'

// --- Types ---

export interface AIMessage {
  id: string
  userId: string       // Supabase user ID
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  metadata?: string    // JSON stringified metadata (tool calls, etc.)
}

export interface AIMemoryEntry {
  id: string
  userId: string
  key: string          // e.g., 'user_name', 'preferred_language'
  value: string
  createdAt: string
  updatedAt: string
}

// --- Dexie Database ---

const aiDb = new Dexie('CrewWorkAI') as Dexie & {
  messages: EntityTable<AIMessage, 'id'>
  memories: EntityTable<AIMemoryEntry, 'id'>
}

aiDb.version(1).stores({
  messages: 'id, userId, timestamp, [userId+timestamp]',
  memories: 'id, userId, key, [userId+key]',
})

// --- Message Operations ---

export async function saveAIMessage(msg: Omit<AIMessage, 'id'>): Promise<AIMessage> {
  const id = crypto.randomUUID()
  const entry: AIMessage = { ...msg, id }
  await aiDb.messages.put(entry)
  return entry
}

export async function getAIConversationHistory(
  userId: string,
  limit: number = 50
): Promise<AIMessage[]> {
  return aiDb.messages
    .where('[userId+timestamp]')
    .between([userId, ''], [userId, '\uffff'])
    .reverse()
    .limit(limit)
    .toArray()
}

// --- Memory Operations ---

export async function setMemory(userId: string, key: string, value: string): Promise<void> {
  const now = new Date().toISOString()
  const existing = await aiDb.memories.where('[userId+key]').equals([userId, key]).first()

  if (existing) {
    await aiDb.memories.update(existing.id, { value, updatedAt: now })
  } else {
    await aiDb.memories.put({
      id: crypto.randomUUID(),
      userId,
      key,
      value,
      createdAt: now,
      updatedAt: now,
    })
  }
}

export async function getMemory(userId: string, key: string): Promise<string | null> {
  const entry = await aiDb.memories.where('[userId+key]').equals([userId, key]).first()
  return entry?.value ?? null
}

export async function getAllMemories(userId: string): Promise<AIMemoryEntry[]> {
  return aiDb.memories.where('userId').equals(userId).toArray()
}

export async function deleteMemory(userId: string, key: string): Promise<void> {
  const entry = await aiDb.memories.where('[userId+key]').equals([userId, key]).first()
  if (entry) {
    await aiDb.memories.delete(entry.id)
  }
}

/**
 * Build memory context string for the LLM prompt.
 * Includes user preferences and key facts.
 */
export async function buildMemoryContext(userId: string): Promise<string> {
  const memories = await getAllMemories(userId)
  if (memories.length === 0) return ''

  const lines = memories.map(m => `- ${m.key}: ${m.value}`)
  return `Known information about this user:\n${lines.join('\n')}`
}
```

**Notes:**
- Separate IndexedDB database (`CrewWorkAI`) to avoid conflicts with existing `CrewWorkLocal`
- Compound index `[userId+timestamp]` for efficient per-user history queries
- Memory system stores user preferences, facts, and learned context
- `buildMemoryContext()` formats memories into a prompt-friendly string

---

### 4.3 `src/lib/ai/tools.ts` — Agent Tools

```typescript
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * Tool: Search messages in a channel.
 */
export const searchChannelMessages = tool(
  async ({ channelId, query, limit }) => {
    // Fetch recent messages from Supabase and search
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

    // Simple text search (server-side)
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
 */
export const saveUserMemory = tool(
  async ({ key, value }) => {
    const { setMemory } = await import('./memory')
    // Note: userId is injected at runtime via the agent's config
    // This tool is called via the agent which has access to userId
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

export const AI_TOOLS = [
  searchChannelMessages,
  getChannels,
  getUserProfile,
  getTodos,
  saveUserMemory,
]
```

**Notes:**
- Tools use the Supabase service role key (server-side only, never exposed to client)
- Each tool is independently testable
- `saveUserMemory` requires userId injection at the agent level (see agent.ts)
- Tools are designed to be self-contained with dynamic imports to avoid bundling Supabase client in browser

---

### 4.4 `src/lib/ai/agent.ts` — LangGraph Agent Core

```typescript
import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from './llm'
import {
  saveAIMessage,
  getAIConversationHistory,
  buildMemoryContext,
  setMemory,
} from './memory'
import { AI_TOOLS } from './tools'

// --- Agent State ---

const AgentState = Annotation.Root({
  messages: Annotation<ReturnType<typeof HumanMessage.prototype.toJSON>[]>({
    reducer: (curr, prev) => [...curr, ...prev],
    default: () => [],
  }),
  userId: Annotation<string>({
    reducer: (_curr, prev) => prev,
    default: () => '',
  }),
  channelId: Annotation<string>({
    reducer: (_curr, prev) => prev,
    default: () => '',
  }),
  memoryContext: Annotation<string>({
    reducer: (_curr, prev) => prev,
    default: () => '',
  }),
})

type AgentStateType = typeof AgentState.State

// --- System Prompt ---

function getSystemPrompt(): string {
  return `You are CrewWork AI, a helpful assistant integrated into the CrewWork team messaging platform.

You can:
- Answer questions and have conversations
- Search messages in channels
- List workspace channels
- Look up user profiles
- View and manage todos
- Remember user preferences and facts

Be concise, helpful, and friendly. Use markdown formatting when appropriate.
When you learn something important about the user, use the save_user_memory tool to remember it.
Keep responses conversational and not overly formal.`
}

// --- Graph Nodes ---

async function loadMemory(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const memoryContext = await buildMemoryContext(state.userId)
  const history = await getAIConversationHistory(state.userId, 30)

  const langchainMessages = history.map(m =>
    m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content)
  )

  return {
    memoryContext,
    messages: langchainMessages,
  }
}

async function callModel(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const model = createChatModel({ temperature: 0.7 })
  const modelWithTools = model.bindTools(AI_TOOLS)

  const systemMessage = new SystemMessage(
    getSystemPrompt() +
    (state.memoryContext ? `\n\n${state.memoryContext}` : '')
  )

  const allMessages = [
    systemMessage,
    ...state.messages,
  ]

  const response = await modelWithTools.invoke(allMessages)

  return {
    messages: [response],
  }
}

async function useTools(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage

  if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    return {}
  }

  const toolMap = Object.fromEntries(AI_TOOLS.map(t => [t.name, t]))
  const toolResults = []

  for (const toolCall of lastMessage.tool_calls) {
    const tool = toolMap[toolCall.name]
    if (!tool) {
      toolResults.push(`Unknown tool: ${toolCall.name}`)
      continue
    }
    const result = await tool.invoke(toolCall.args)
    toolResults.push(result)
  }

  // Convert tool results to ToolMessage format
  const toolMessages = toolResults.map((result, i) => ({
    _getType: () => 'tool' as const,
    content: String(result),
    tool_call_id: lastMessage.tool_calls![i].id!,
    name: lastMessage.tool_calls![i].name,
  }))

  return {
    messages: toolMessages as any,
  }
}

async function saveMessages(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Find the last human message
  const humanMessages = state.messages.filter(m => m._getType?.() === 'human')
  const lastHuman = humanMessages[humanMessages.length - 1]

  // Find the last AI message (final response, not tool-calling intermediate)
  const aiMessages = state.messages.filter(m => m._getType?.() === 'ai') as AIMessage[]
  const lastAI = aiMessages[aiMessages.length - 1]

  if (lastHuman) {
    await saveAIMessage({
      userId: state.userId,
      role: 'user',
      content: typeof lastHuman.content === 'string' ? lastHuman.content : JSON.stringify(lastHuman.content),
      timestamp: new Date().toISOString(),
    })
  }

  if (lastAI && (!lastAI.tool_calls || lastAI.tool_calls.length === 0)) {
    await saveAIMessage({
      userId: state.userId,
      role: 'assistant',
      content: typeof lastAI.content === 'string' ? lastAI.content : JSON.stringify(lastAI.content),
      timestamp: new Date().toISOString(),
    })
  }

  return {}
}

// --- Routing ---

function shouldUseTools(state: AgentStateType): 'tools' | 'save' {
  const lastMessage = state.messages[state.messages.length - 1]
  if (lastMessage._getType?.() === 'ai') {
    const aiMsg = lastMessage as AIMessage
    if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
      return 'tools'
    }
  }
  return 'save'
}

// --- Build Graph ---

function buildAgentGraph() {
  const graph = new StateGraph(AgentState)
    .addNode('load_memory', loadMemory)
    .addNode('call_model', callModel)
    .addNode('use_tools', useTools)
    .addNode('save_messages', saveMessages)

    .addEdge(START, 'load_memory')
    .addEdge('load_memory', 'call_model')
    .addConditionalEdges('call_model', shouldUseTools, {
      tools: 'use_tools',
      save: 'save_messages',
    })
    .addEdge('use_tools', 'call_model')
    .addEdge('save_messages', END)

  return graph.compile()
}

// --- Main Export ---

const compiledGraph = buildAgentGraph()

export interface AgentChatRequest {
  userId: string
  channelId: string
  message: string
  workspaceId?: string
}

export interface AgentChatResponse {
  reply: string
  toolCalls?: string[]
}

export async function chatWithAgent(request: AgentChatRequest): Promise<AgentChatResponse> {
  const { userId, channelId, message, workspaceId } = request

  const result = await compiledGraph.invoke({
    messages: [new HumanMessage(message)],
    userId,
    channelId,
    memoryContext: '',
  })

  // Extract final AI response
  const aiMessages = result.messages.filter(
    (m: any) => m._getType?.() === 'ai'
  ) as AIMessage[]
  const finalResponse = aiMessages[aiMessages.length - 1]

  // Track which tools were used
  const toolCallNames = result.messages
    .filter((m: any) => m._getType?.() === 'ai')
    .flatMap((m: any) => (m.tool_calls ?? []).map((tc: any) => tc.name))

  return {
    reply: typeof finalResponse.content === 'string'
      ? finalResponse.content
      : JSON.stringify(finalResponse.content),
    toolCalls: toolCallNames.length > 0 ? toolCallNames : undefined,
  }
}
```

**Notes:**
- LangGraph's `StateGraph` manages the conversation flow with explicit nodes
- `load_memory` → `call_model` → (optionally) `use_tools` → `call_model` → `save_messages`
- Memory is loaded before each turn and messages are saved after
- The `shouldUseTools` router handles the tool-calling loop (model can call multiple tools)
- Messages are persisted to IndexedDB for the memory system

---

### 4.5 `src/app/api/ai/chat/route.ts` — API Route

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { chatWithAgent } from '@/lib/ai/agent'
import { saveAIMessage } from '@/lib/ai/memory'

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
```

**Notes:**
- Auth verification follows existing pattern from `upload/route.ts`
- Channel membership check ensures users can only chat with AI in channels they belong to
- AI response is saved to the `messages` table so realtime subscriptions deliver it to all clients
- Uses `AI_AGENT_ID` as the sender so the UI can distinguish AI messages
- Metadata field stores tool call info for debugging

---

### 4.6 `src/components/ai/ai-chat.tsx` — AI Chat UI Component

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Wrench } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: string[]
}

interface AIChatProps {
  channelId: string
}

export function AIChat({ channelId }: AIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const user = useAppStore((s) => s.user)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Load conversation history on mount
  useEffect(() => {
    async function loadHistory() {
      const supabase = getSupabaseClient()
      if (!supabase || !user) return

      const { data } = await supabase
        .from('messages')
        .select('id, content, sender_id, created_at, metadata')
        .eq('channel_id', channelId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(100)

      if (data) {
        const aiAgentId = process.env.NEXT_PUBLIC_AI_AGENT_ID ?? '00000000-0000-0000-0000-000000000000'
        const chatMessages: ChatMessage[] = data
          .filter(m => m.sender_id === user.id || m.sender_id === aiAgentId)
          .map(m => ({
            id: m.id,
            role: m.sender_id === aiAgentId ? 'assistant' : 'user',
            content: m.content,
            timestamp: m.created_at,
            toolCalls: m.metadata ? JSON.parse(m.metadata).tool_calls : undefined,
          }))
        setMessages(chatMessages)
      }
    }
    loadHistory()
  }, [channelId, user])

  async function handleSend() {
    const text = input.trim()
    if (!text || isLoading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    try {
      const supabase = getSupabaseClient()
      const session = await supabase?.auth.getSession()

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.data.session?.access_token}`,
        },
        body: JSON.stringify({
          message: text,
          channelId,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to get AI response')
      }

      const data = await response.json()

      const aiMsg: ChatMessage = {
        id: data.messageId || crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
        toolCalls: data.toolCalls,
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div ref={scrollRef} className="space-y-4 max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">CrewWork AI</p>
              <p className="text-sm mt-1">
                Ask me anything! I can search messages, list channels, and remember your preferences.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground">
                    <Bot className="w-3 h-3" />
                    <span>CrewWork AI</span>
                    {msg.toolCalls && (
                      <span className="flex items-center gap-0.5 ml-2">
                        <Wrench className="w-3 h-3" />
                        {msg.toolCalls.join(', ')}
                      </span>
                    )}
                  </div>
                )}
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message CrewWork AI..."
            className="min-h-[44px] resize-none"
            rows={1}
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Notes:**
- Standalone component that can be embedded in any channel view
- Loads conversation history from Supabase on mount
- Sends messages to the API route and displays responses
- Shows tool call indicators when the agent uses tools
- Uses existing UI primitives (Button, Textarea, ScrollArea)
- Enter to send, Shift+Enter for newline (matches existing message-input behavior)

---

## 5. Database Changes

### New Migration: AI Agent Profile

Add to `src/lib/supabase/migrations.ts` (new migration entry):

```sql
-- Migration: Add AI agent profile
-- This creates a special profile for the AI bot

-- The AI agent profile is created via SQL since it's not a real auth user
INSERT INTO profiles (id, email, display_name, avatar_url, status_text, status_emoji, is_online, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'ai@crewwork.local',
  'CrewWork AI',
  NULL,  -- Will use default avatar
  'Always here to help',
  '🤖',
  true,
  NOW()
)
ON CONFLICT (id) DO NOTHING;
```

### New Migration: AI Channel Auto-Creation

Add a function that auto-creates the `#ai-assistant` channel when a workspace is created:

```sql
-- Auto-create #ai-assistant channel in new workspaces
CREATE OR REPLACE FUNCTION handle_new_workspace_ai_channel()
RETURNS TRIGGER AS $$
DECLARE
  ai_user_id UUID := '00000000-0000-0000-0000-000000000000';
  new_channel_id UUID;
BEGIN
  -- Create #ai-assistant channel
  INSERT INTO channels (id, workspace_id, name, description, is_private, is_archived, created_by, created_at)
  VALUES (
    gen_random_uuid(),
    NEW.id,
    '#ai-assistant',
    'Chat with CrewWork AI assistant. Ask questions, search messages, manage todos, and more.',
    false,
    false,
    ai_user_id,
    NOW()
  )
  RETURNING id INTO new_channel_id;

  -- Add the workspace owner as a member
  INSERT INTO channel_members (channel_id, profile_id, role, notification_pref, joined_at)
  SELECT new_channel_id, wm.profile_id, 'member', 'all', NOW()
  FROM workspace_members wm
  WHERE wm.workspace_id = NEW.id AND wm.role = 'owner';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on workspace creation
CREATE TRIGGER on_workspace_created_ai_channel
  AFTER INSERT ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_workspace_ai_channel();
```

### Supabase: Expose AI_AGENT_ID to Client

Add to `.env.local` and make public:

```
NEXT_PUBLIC_AI_AGENT_ID=00000000-0000-0000-0000-000000000000
```

---

## 6. Integration Points

### 6.1 Channel View Integration

Modify `src/components/chat/channel-view.tsx` to detect AI channels and render the AI chat component:

```typescript
// In the message area, detect if this is the AI channel
const AI_CHANNEL_NAME = '#ai-assistant'

// When rendering the message area:
{channel.name === AI_CHANNEL_NAME ? (
  <AIChat channelId={channel.id} />
) : (
  // Existing message list + input
)}
```

### 6.2 Sidebar Integration

In `src/components/sidebar/sidebar.tsx`, the `#ai-assistant` channel will appear automatically in the channel list since it's a regular public channel. Optionally add a special icon:

```typescript
// In the channel list item rendering:
{channel.name === '#ai-assistant' && (
  <Bot className="w-4 h-4 text-muted-foreground" />
)}
```

### 6.3 Message Bubble Integration

Modify `src/components/chat/message-bubble.tsx` to show AI messages differently:

```typescript
// Detect AI sender
const isAIMessage = message.sender_id === process.env.NEXT_PUBLIC_AI_AGENT_ID

// When rendering:
{isAIMessage && (
  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
    <Bot className="w-3 h-3" />
    <span>CrewWork AI</span>
  </div>
)}
```

### 6.4 Realtime Integration

The AI response is saved to the `messages` table, so existing realtime subscriptions in `channel-view.tsx` will automatically pick up AI messages and display them. No changes needed to the realtime subscription code.

### 6.5 Zustand Store Additions (Optional)

Add to `src/lib/store/app-store.ts`:

```typescript
// In AppState interface:
aiChannelId: string | null
setAiChannelId: (id: string | null) => void

// In the store:
aiChannelId: null,
setAiChannelId: (aiChannelId) => set({ aiChannelId }),
```

---

## 7. Testing Strategy

### Unit Tests

1. **`llm.ts`** — Test model creation, verify DeepSeek API key is used
2. **`memory.ts`** — Test CRUD operations on AIMessage and AIMemoryEntry
3. **`tools.ts`** — Test each tool independently with mocked Supabase

### Integration Tests

4. **`agent.ts`** — Test the full graph with a mock LLM (no real API calls)
5. **`route.ts`** — Test auth verification, channel membership, error handling

### Manual Testing

6. Create a workspace → verify `#ai-assistant` channel is auto-created
7. Send a message → verify AI response appears in real-time
8. Test tool usage → ask "list all channels" → verify response
9. Test memory → tell AI your name → start new conversation → verify it remembers
10. Test error handling → send empty message, very long message, invalid channel

### Performance Considerations

- **Memory limit**: Keep conversation history to last 30 messages (configurable)
- **Response time**: DeepSeek flash model typically responds in 1-3 seconds
- **Rate limiting**: Consider adding rate limiting in Phase 2 (not blocking for Phase 1)
- **Token costs**: DeepSeek is ~10x cheaper than GPT-4, so cost is minimal

---

## 8. File Summary

| File | Purpose | New/Modified |
|------|---------|--------------|
| `src/lib/ai/llm.ts` | DeepSeek LLM factory | New |
| `src/lib/ai/memory.ts` | IndexedDB conversation memory | New |
| `src/lib/ai/tools.ts` | Agent tools (channel search, todos, etc.) | New |
| `src/lib/ai/agent.ts` | LangGraph agent orchestration | New |
| `src/app/api/ai/chat/route.ts` | API endpoint for AI chat | New |
| `src/components/ai/ai-chat.tsx` | AI chat UI component | New |
| `src/lib/supabase/migrations.ts` | Add AI profile + channel trigger | Modified |
| `src/components/chat/channel-view.tsx` | Detect AI channel, render AIChat | Modified |
| `src/components/chat/message-bubble.tsx` | Show AI badge on AI messages | Modified |
| `src/components/sidebar/sidebar.tsx` | Optional: AI channel icon | Modified |
| `.env.local` | Add DEEPSEEK_API_KEY, AI_AGENT_ID | Modified |
| `package.json` | Add langchain, langgraph dependencies | Modified |

---

## 9. Implementation Order

1. Install dependencies (`npm install langchain @langchain/core @langchain/community langgraph`)
2. Create `src/lib/ai/llm.ts` (simplest, no dependencies)
3. Create `src/lib/ai/memory.ts` (Dexie-based, self-contained)
4. Create `src/lib/ai/tools.ts` (depends on Supabase, self-contained)
5. Create `src/lib/ai/agent.ts` (orchestrates everything)
6. Create `src/app/api/ai/chat/route.ts` (API endpoint)
7. Create `src/components/ai/ai-chat.tsx` (UI)
8. Add database migrations (AI profile + channel trigger)
9. Modify channel-view.tsx for AI channel detection
10. Modify message-bubble.tsx for AI message styling
11. Update .env.local with new variables
12. Manual testing
