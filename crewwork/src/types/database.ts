export interface Profile {
  id: string
  email: string | null
  display_name: string
  avatar_url: string | null
  status_emoji: string | null
  status_text: string | null
  is_online: boolean
  last_seen_at: string | null
  created_at: string
  sync_started_at: string | null
  // E2EE fields
  public_key?: string | null          // Identity public key (base64)
  prekey_bundle?: Record<string, unknown> | null  // Prekey bundle for X3DH
  identity_backup?: Record<string, unknown> | null  // Encrypted identity key for multi-device
  channel_keys_sync?: Record<string, string> | null  // Encrypted channel keys for sync
}

export interface Workspace {
  id: string
  name: string
  slug: string
  icon_url: string | null
  workspace_type: 'personal' | 'business'
  personal_name: string | null
  calls_enabled: boolean
  created_at: string
}

export interface WorkspaceMember {
  workspace_id: string
  profile_id: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
  workspace?: Workspace
  profile?: Profile
}

export interface Channel {
  id: string
  workspace_id: string
  name: string
  description: string | null
  topic: string | null
  is_private: boolean
  is_archived: boolean
  created_by: string | null
  created_at: string
  calls_enabled: boolean
}

export interface ChannelMember {
  channel_id: string
  profile_id: string
  role: string
  notification_pref: string
  joined_at: string
}

export interface Message {
  id: string
  channel_id: string
  sender_id: string | null
  content: string
  parent_id: string | null
  thread_reply_count: number
  is_edited: boolean
  is_deleted: boolean
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  sender?: Profile
}

export interface FileAttachment {
  id: string
  message_id: string
  file_name: string
  file_url: string
  file_size: number | null
  mime_type: string | null
  created_at: string
}

export interface Todo {
  id: string
  workspace_id: string
  channel_id: string | null
  title: string
  description: string | null
  status: 'TODO' | 'IN_PROGRESS' | 'DONE'
  priority: 'low' | 'medium' | 'high'
  assigned_to: string | null
  created_by: string
  due_date: string | null
  position: number
  created_at: string
  updated_at: string
  assignee?: Profile
  creator?: Profile
  channel?: Channel
}

export interface Contact {
  id: string
  user_id: string
  contact_id: string
  status: 'accepted' | 'pending' | 'blocked'
  created_at: string
  updated_at: string
  contact_profile?: Profile
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
