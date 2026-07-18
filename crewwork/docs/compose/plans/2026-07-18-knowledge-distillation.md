# AI Knowledge Distillation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save posts from channels into a local-first knowledge base, where AI compresses them into structured knowledge that personalizes the AI assistant and teaches the user.

**Architecture:** Dexie (IndexedDB) stores raw saved posts and AI-compressed structured knowledge. An API route runs the AI compression via LangChain. The AI agent reads compressed knowledge in `buildMemoryContext()` to personalize responses. A bookmarks panel in the sidebar lets users browse and manage saved posts. Everything works offline; Supabase sync is optional.

**Tech Stack:** Dexie, LangChain (DeepSeek), Tiptap (for note editing), Zustand, shadcn/ui

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/local/db.ts` | Modify | Add `savedPosts` and `compressedKnowledge` tables |
| `src/types/database.ts` | Modify | Add `SavedPost` and `CompressedKnowledge` interfaces |
| `src/lib/ai/compress.ts` | Create | AI compression logic — takes raw post, returns structured JSON |
| `src/app/api/ai/compress/route.ts` | Create | API endpoint for AI compression |
| `src/lib/ai/memory.ts` | Modify | Feed compressed knowledge into `buildMemoryContext()` |
| `src/components/bookmarks/bookmarks-panel.tsx` | Create | Sidebar panel showing saved posts |
| `src/components/bookmarks/save-post-button.tsx` | Create | Button on message bubbles to save a post |
| `src/components/chat/message-bubble.tsx` | Modify | Add save button to hover toolbar |
| `src/components/sidebar/sidebar.tsx` | Modify | Add Bookmarks section + panel toggle |
| `src/lib/store/app-store.ts` | Modify | Add bookmarks panel state |

---

## Global Constraints

- All Dexie table changes bump the version number in `db.ts`
- AI compression uses the existing DeepSeek model via `createChatModel()` from `src/lib/ai/llm.ts`
- Compressed knowledge format: `{ concepts: string[], relationships: {from: string, to: string, type: string}[], actionItems: string[], summary: string, tags: string[] }`
- Bookmarks panel follows the same UI patterns as `TodosPanel` and `ContactsPanel`
- No new npm dependencies — use existing Dexie, LangChain, shadcn/ui

---

### Task 1: Database Schema — Dexie Tables

**Covers:** Local-first storage for saved posts and compressed knowledge

**Files:**
- Modify: `src/lib/local/db.ts`
- Modify: `src/types/database.ts`

**Interfaces:**
- Produces: `SavedPost`, `CompressedKnowledge` types + Dexie tables

- [ ] **Step 1: Add types to database.ts**

Add at the end of `src/types/database.ts`:

```typescript
export interface SavedPost {
  id: string
  userId: string
  messageId: string
  channelId: string
  channelName: string
  senderId: string
  senderName: string
  content: string
  savedAt: string
  compressed: boolean
}

export interface CompressedKnowledge {
  id: string
  userId: string
  savedPostId: string
  concepts: string[]
  relationships: { from: string; to: string; type: string }[]
  actionItems: string[]
  summary: string
  tags: string[]
  compressedAt: string
}
```

- [ ] **Step 2: Update Dexie schema in db.ts**

Replace the full content of `src/lib/local/db.ts`:

```typescript
import Dexie, { type EntityTable } from 'dexie'

export interface LocalMessage {
  id: string
  channel_id: string
  sender_id: string
  content: string
  created_at: string
  is_deleted: boolean
  parent_id: string | null
  synced: boolean
  sender_name: string
  sender_avatar: string | null
}

export interface LocalFile {
  id: string
  message_id: string
  name: string
  blob: Blob
  type: string
  synced: boolean
  channelId: string
  senderId: string
}

export interface LocalSetting {
  key: string
  value: string
}

export interface SavedPost {
  id: string
  userId: string
  messageId: string
  channelId: string
  channelName: string
  senderId: string
  senderName: string
  content: string
  savedAt: string
  compressed: boolean
}

export interface CompressedKnowledge {
  id: string
  userId: string
  savedPostId: string
  concepts: string[]
  relationships: { from: string; to: string; type: string }[]
  actionItems: string[]
  summary: string
  tags: string[]
  compressedAt: string
}

const db = new Dexie('CrewWorkLocal') as Dexie & {
  messages: EntityTable<LocalMessage, 'id'>
  files: EntityTable<LocalFile, 'id'>
  settings: EntityTable<LocalSetting, 'key'>
  savedPosts: EntityTable<SavedPost, 'id'>
  compressedKnowledge: EntityTable<CompressedKnowledge, 'id'>
}

db.version(3).stores({
  messages: 'id, channel_id, created_at, synced',
  files: 'id, message_id, synced, channelId, senderId',
  settings: 'key',
  savedPosts: 'id, userId, channelId, savedAt, compressed',
  compressedKnowledge: 'id, userId, savedPostId, compressedAt',
})

export { db }
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/local/db.ts src/types/database.ts
git commit -m "feat: add savedPosts and compressedKnowledge Dexie tables"
```

---

### Task 2: AI Compression Logic

**Covers:** AI compression of saved posts into structured JSON

**Files:**
- Create: `src/lib/ai/compress.ts`

**Interfaces:**
- Consumes: `createChatModel` from `src/lib/ai/llm.ts`
- Produces: `compressPost(content: string, channelName: string, senderName: string) → Promise<CompressedKnowledge>` (returns everything except id/userId/savedPostId/compressedAt which are filled by caller)

- [ ] **Step 1: Create compress.ts**

Create `src/lib/ai/compress.ts`:

```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from './llm'
import type { CompressedKnowledge } from '@/lib/local/db'

type CompressionResult = Omit<CompressedKnowledge, 'id' | 'userId' | 'savedPostId' | 'compressedAt'>

export async function compressPost(
  content: string,
  channelName: string,
  senderName: string
): Promise<CompressionResult> {
  const model = createChatModel({ temperature: 0.3 })

  const systemPrompt = `You are a knowledge compression engine. Analyze the following post and extract structured knowledge.

Return ONLY a valid JSON object with this exact shape (no markdown, no explanation):
{
  "concepts": ["key concept 1", "key concept 2"],
  "relationships": [{"from": "concept A", "to": "concept B", "type": "related_to|depends_on|contradicts|extends"}],
  "actionItems": ["actionable takeaway 1"],
  "summary": "one-paragraph distilled summary",
  "tags": ["tag1", "tag2"]
}

Rules:
- concepts: 3-8 key ideas, terms, or topics from the post
- relationships: how concepts relate to each other (1-5 relationships)
- actionItems: practical takeaways the user can act on (0-5 items)
- summary: concise 1-2 sentence summary capturing the essence
- tags: 2-5 lowercase topic tags for categorization`

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(`Channel: ${channelName}\nAuthor: ${senderName}\n\nContent:\n${content}`),
  ])

  const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      concepts: [],
      relationships: [],
      actionItems: [],
      summary: content.slice(0, 200),
      tags: [],
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : content.slice(0, 200),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    }
  } catch {
    return {
      concepts: [],
      relationships: [],
      actionItems: [],
      summary: content.slice(0, 200),
      tags: [],
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/compress.ts
git commit -m "feat: add AI compression logic for saved posts"
```

---

### Task 3: Compression API Route

**Covers:** Server endpoint for compressing saved posts

**Files:**
- Create: `src/app/api/ai/compress/route.ts`

**Interfaces:**
- Consumes: `compressPost` from `src/lib/ai/compress.ts`
- Produces: POST endpoint returning compressed knowledge JSON

- [ ] **Step 1: Create the route**

Create `src/app/api/ai/compress/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { compressPost } from '@/lib/ai/compress'

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { content, channelName, senderName } = await request.json()

    if (!content) {
      return NextResponse.json({ error: 'Missing content' }, { status: 400 })
    }

    const result = await compressPost(content, channelName || 'unknown', senderName || 'unknown')

    return NextResponse.json(result)
  } catch (error) {
    console.error('Compression error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Compression failed' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/ai/compress/route.ts
git commit -m "feat: add AI compression API route"
```

---

### Task 4: Feed Compressed Knowledge into AI Memory

**Covers:** AI personalization using compressed knowledge

**Files:**
- Modify: `src/lib/ai/memory.ts`

**Interfaces:**
- Consumes: `CompressedKnowledge` from Dexie
- Produces: Updated `buildMemoryContext()` that includes compressed knowledge

- [ ] **Step 1: Update memory.ts**

Add the compressed knowledge import and update `buildMemoryContext` in `src/lib/ai/memory.ts`:

At the top, after the existing imports, add:

```typescript
import { db as localDb, type CompressedKnowledge } from '@/lib/local/db'
```

Then replace the `buildMemoryContext` function:

```typescript
export async function buildMemoryContext(userId: string): Promise<string> {
  const memories = await getAllMemories(userId)
  const knowledge = await localDb.compressedKnowledge.where('userId').equals(userId).toArray()

  const parts: string[] = []

  if (memories.length > 0) {
    const lines = memories.map(m => `- ${m.key}: ${m.value}`)
    parts.push(`Known information about this user:\n${lines.join('\n')}`)
  }

  if (knowledge.length > 0) {
    const concepts = [...new Set(knowledge.flatMap(k => k.concepts))]
    const tags = [...new Set(knowledge.flatMap(k => k.tags))]
    const actionItems = knowledge.flatMap(k => k.actionItems)

    if (concepts.length > 0) {
      parts.push(`Topics the user has saved and studied:\n${concepts.map(c => `- ${c}`).join('\n')}`)
    }
    if (tags.length > 0) {
      parts.push(`User's interest areas: ${tags.join(', ')}`)
    }
    if (actionItems.length > 0) {
      parts.push(`Key takeaways from saved content:\n${actionItems.map(a => `- ${a}`).join('\n')}`)
    }
  }

  return parts.join('\n\n')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai/memory.ts
git commit -m "feat: feed compressed knowledge into AI memory context"
```

---

### Task 5: Save Post Button on Message Bubble

**Covers:** UI for saving posts from messages

**Files:**
- Create: `src/components/bookmarks/save-post-button.tsx`
- Modify: `src/components/chat/message-bubble.tsx`

**Interfaces:**
- Consumes: `db` from `src/lib/local/db`, `useAppStore` for user/channel
- Produces: `SavePostButton` component rendered in message hover toolbar

- [ ] **Step 1: Create SavePostButton component**

Create `src/components/bookmarks/save-post-button.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'
import { db } from '@/lib/local/db'
import { useAppStore } from '@/lib/store/app-store'
import type { Message } from '@/types/database'

interface SavePostButtonProps {
  message: Message
  channelName: string
}

export function SavePostButton({ message, channelName }: SavePostButtonProps) {
  const { user } = useAppStore()
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  // Check if already saved on mount
  useState(() => {
    if (!user) return
    db.savedPosts
      .where('messageId')
      .equals(message.id)
      .first()
      .then((existing) => {
        if (existing) setSaved(true)
      })
  })

  async function handleSave() {
    if (!user || saved || loading) return
    setLoading(true)

    try {
      const id = crypto.randomUUID()
      await db.savedPosts.add({
        id,
        userId: user.id,
        messageId: message.id,
        channelId: message.channel_id,
        channelName,
        senderId: message.sender_id || '',
        senderName: message.sender?.display_name || 'Unknown',
        content: message.content,
        savedAt: new Date().toISOString(),
        compressed: false,
      })
      setSaved(true)

      // Trigger background compression
      compressInBackground(id, message.content, channelName, message.sender?.display_name || 'Unknown')
    } catch (err) {
      console.error('Failed to save post:', err)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <button className="h-7 w-7 flex items-center justify-center rounded-lg" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#A8A29E' }} />
      </button>
    )
  }

  return (
    <button
      onClick={handleSave}
      className="h-7 w-7 flex items-center justify-center hover:bg-[#FEF2F2] rounded-lg transition-colors"
      title={saved ? 'Saved' : 'Save to knowledge base'}
    >
      {saved ? (
        <BookmarkCheck className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />
      ) : (
        <Bookmark className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
      )}
    </button>
  )
}

async function compressInBackground(
  savedPostId: string,
  content: string,
  channelName: string,
  senderName: string
) {
  try {
    const res = await fetch('/api/ai/compress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, channelName, senderName }),
    })
    if (!res.ok) return

    const result = await res.json()
    const post = await db.savedPosts.get(savedPostId)
    if (!post) return

    await db.compressedKnowledge.add({
      id: crypto.randomUUID(),
      userId: post.userId,
      savedPostId,
      concepts: result.concepts || [],
      relationships: result.relationships || [],
      actionItems: result.actionItems || [],
      summary: result.summary || '',
      tags: result.tags || [],
      compressedAt: new Date().toISOString(),
    })

    await db.savedPosts.update(savedPostId, { compressed: true })
  } catch (err) {
    console.error('Background compression failed:', err)
  }
}
```

- [ ] **Step 2: Add SavePostButton to message bubble toolbar**

In `src/components/chat/message-bubble.tsx`, add the import at the top:

```typescript
import { SavePostButton } from '@/components/bookmarks/save-post-button'
```

Then in the toolbar section (inside the `{showToolbar && !editing && (` block), after the quick reactions div and before the divider, add:

```typescript
<SavePostButton message={message} channelName={''} />
```

Note: The `channelName` prop will be empty string for now — the component gets it from the message context. We'll refine this if needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/bookmarks/save-post-button.tsx src/components/chat/message-bubble.tsx
git commit -m "feat: add save post button to message hover toolbar"
```

---

### Task 6: Bookmarks Panel

**Covers:** Sidebar panel for browsing saved posts

**Files:**
- Create: `src/components/bookmarks/bookmarks-panel.tsx`

**Interfaces:**
- Consumes: `db` from `src/lib/local/db`, `useAppStore` for user
- Produces: `BookmarksPanel` component (same pattern as TodosPanel/ContactsPanel)

- [ ] **Step 1: Create BookmarksPanel**

Create `src/components/bookmarks/bookmarks-panel.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { X, Bookmark, Trash2, Sparkles, Loader2, ExternalLink } from 'lucide-react'
import { db, type SavedPost, type CompressedKnowledge } from '@/lib/local/db'
import { useAppStore } from '@/lib/store/app-store'
import { formatDistanceToNow } from 'date-fns'

interface BookmarksPanelProps {
  open: boolean
  onClose: () => void
}

export function BookmarksPanel({ open, onClose }: BookmarksPanelProps) {
  const { user } = useAppStore()
  const [posts, setPosts] = useState<(SavedPost & { knowledge?: CompressedKnowledge })[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPost, setSelectedPost] = useState<SavedPost & { knowledge?: CompressedKnowledge } | null>(null)

  useEffect(() => {
    if (!open || !user) return
    loadPosts()
  }, [open, user])

  async function loadPosts() {
    if (!user) return
    setLoading(true)

    const savedPosts = await db.savedPosts
      .where('userId')
      .equals(user.id)
      .reverse()
      .sortBy('savedAt')

    // Load compressed knowledge for each post
    const postsWithKnowledge = await Promise.all(
      savedPosts.map(async (post) => {
        const knowledge = await db.compressedKnowledge
          .where('savedPostId')
          .equals(post.id)
          .first()
        return { ...post, knowledge }
      })
    )

    setPosts(postsWithKnowledge)
    setLoading(false)
  }

  async function handleDelete(id: string) {
    await db.savedPosts.delete(id)
    await db.compressedKnowledge.where('savedPostId').equals(id).delete()
    setPosts(prev => prev.filter(p => p.id !== id))
    if (selectedPost?.id === id) setSelectedPost(null)
  }

  if (!open) return null

  return (
    <div className="w-80 flex flex-col h-full shrink-0" style={{ background: '#ffffff', borderLeft: '1px solid #E7E5E4' }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid #E7E5E4' }}>
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4" style={{ color: '#DC2626' }} />
          <h3 className="font-bold text-[17px]" style={{ color: '#1C1917' }}>Knowledge Base</h3>
        </div>
        <button className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#FEF2F2] transition-colors" onClick={onClose}>
          <X className="h-4 w-4" style={{ color: '#A8A29E' }} />
        </button>
      </div>

      {selectedPost ? (
        /* Detail view */
        <div className="flex-1 overflow-y-auto">
          <button
            onClick={() => setSelectedPost(null)}
            className="px-5 py-2 text-xs font-medium hover:underline"
            style={{ color: '#DC2626' }}
          >
            ← Back to all saved posts
          </button>

          <div className="px-5 py-4 space-y-4">
            {/* Original content */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#A8A29E' }}>
                Saved from #{selectedPost.channelName}
              </label>
              <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: '#1C1917' }}>
                {selectedPost.content}
              </p>
              <p className="text-xs mt-2" style={{ color: '#A8A29E' }}>
                by {selectedPost.senderName} · {formatDistanceToNow(new Date(selectedPost.savedAt), { addSuffix: true })}
              </p>
            </div>

            {/* Compressed knowledge */}
            {selectedPost.knowledge && (
              <>
                <div className="h-px" style={{ background: '#E7E5E4' }} />

                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1" style={{ color: '#A8A29E' }}>
                    <Sparkles className="h-3 w-3" /> AI Summary
                  </label>
                  <p className="text-sm mt-1" style={{ color: '#1C1917' }}>
                    {selectedPost.knowledge.summary}
                  </p>
                </div>

                {selectedPost.knowledge.concepts.length > 0 && (
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#A8A29E' }}>
                      Key Concepts
                    </label>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {selectedPost.knowledge.concepts.map((concept, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                          {concept}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedPost.knowledge.actionItems.length > 0 && (
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#A8A29E' }}>
                      Action Items
                    </label>
                    <ul className="mt-1.5 space-y-1">
                      {selectedPost.knowledge.actionItems.map((item, i) => (
                        <li key={i} className="text-sm flex items-start gap-2" style={{ color: '#1C1917' }}>
                          <span style={{ color: '#DC2626' }}>→</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedPost.knowledge.tags.length > 0 && (
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#A8A29E' }}>
                      Tags
                    </label>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {selectedPost.knowledge.tags.map((tag, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#FEF2F2', color: '#78716C', border: '1px solid #E7E5E4' }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {!selectedPost.knowledge && selectedPost.compressed === false && (
              <div className="flex items-center gap-2 text-xs" style={{ color: '#A8A29E' }}>
                <Loader2 className="h-3 w-3 animate-spin" />
                AI is compressing this post...
              </div>
            )}
          </div>
        </div>
      ) : (
        /* List view */
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: '#DC2626' }} />
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Bookmark className="h-10 w-10 mb-3" style={{ color: '#E7E5E4' }} />
              <p className="text-sm font-medium" style={{ color: '#78716C' }}>No saved posts yet</p>
              <p className="text-xs mt-1" style={{ color: '#A8A29E' }}>
                Click the bookmark icon on any message to save it to your knowledge base
              </p>
            </div>
          ) : (
            <div className="py-2">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="group px-5 py-3 hover:bg-[#FEF2F2] cursor-pointer transition-colors"
                  onClick={() => setSelectedPost(post)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm line-clamp-2" style={{ color: '#1C1917' }}>
                        {post.content}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs" style={{ color: '#A8A29E' }}>
                          #{post.channelName}
                        </span>
                        <span className="text-xs" style={{ color: '#A8A29E' }}>·</span>
                        <span className="text-xs" style={{ color: '#A8A29E' }}>
                          {formatDistanceToNow(new Date(post.savedAt), { addSuffix: true })}
                        </span>
                        {post.knowledge && (
                          <>
                            <span className="text-xs" style={{ color: '#A8A29E' }}>·</span>
                            <Sparkles className="h-3 w-3" style={{ color: '#DC2626' }} />
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(post.id) }}
                      className="h-6 w-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" style={{ color: '#E55B5B' }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/bookmarks/bookmarks-panel.tsx
git commit -m "feat: add bookmarks/knowledge base panel"
```

---

### Task 7: Wire Bookmarks Panel into Sidebar

**Covers:** Sidebar integration for bookmarks access

**Files:**
- Modify: `src/components/sidebar/sidebar.tsx`
- Modify: `src/lib/store/app-store.ts`

**Interfaces:**
- Consumes: `BookmarksPanel` from task 6
- Produces: Bookmarks button in sidebar + panel toggle

- [ ] **Step 1: Add bookmarks panel state to store**

In `src/lib/store/app-store.ts`, add to the `AppState` interface (after `contactsPanelOpen` or similar):

```typescript
bookmarksOpen: boolean
setBookmarksOpen: (open: boolean) => void
```

Add to the initial state:

```typescript
bookmarksOpen: false,
```

Add the setter:

```typescript
setBookmarksOpen: (bookmarksOpen) => set({ bookmarksOpen }),
```

Add to `signOut`:

```typescript
bookmarksOpen: false,
```

- [ ] **Step 2: Add Bookmarks button and panel to sidebar**

In `src/components/sidebar/sidebar.tsx`, add imports:

```typescript
import { Bookmark } from 'lucide-react'
import { BookmarksPanel } from '@/components/bookmarks/bookmarks-panel'
```

Add state (near the other panel states around line 70):

```typescript
const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false)
```

Add a Bookmarks button in the workspaces tab, after the Todos button (around line 667):

```typescript
{/* Bookmarks button */}
<div className="pb-1">
  <button
    onClick={() => setBookmarksPanelOpen(true)}
    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-[13px] hover:shadow-sm"
    style={{ background: '#ffffff', color: '#78716C', border: '1px solid #E7E5E4' }}
  >
    <Bookmark className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />
    <span className="flex-1 text-left font-medium">Knowledge Base</span>
  </button>
</div>
```

Add the BookmarksPanel component at the end (near the other panels around line 932):

```typescript
<BookmarksPanel open={bookmarksPanelOpen} onClose={() => setBookmarksPanelOpen(false)} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/sidebar.tsx src/lib/store/app-store.ts
git commit -m "feat: wire bookmarks panel into sidebar"
```

---

### Task 8: Build Verification

**Covers:** Verify everything compiles and renders correctly

**Files:**
- None (verification only)

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors (or only pre-existing ones)

- [ ] **Step 2: Run build**

```bash
npx next build
```

Expected: Build succeeds

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve any build issues from knowledge base feature"
```
