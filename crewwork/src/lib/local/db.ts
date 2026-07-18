import Dexie, { type EntityTable } from 'dexie'
import type { SavedPost, CompressedKnowledge } from '@/types/database'

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
