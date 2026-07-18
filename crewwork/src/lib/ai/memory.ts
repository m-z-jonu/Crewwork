import Dexie, { type EntityTable } from 'dexie'
import { db as localDb } from '@/lib/local/db'
import type { CompressedKnowledge } from '@/types/database'

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
 * Includes user preferences, key facts, and compressed knowledge from saved posts.
 */
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
