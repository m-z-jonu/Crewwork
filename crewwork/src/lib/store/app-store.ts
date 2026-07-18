import { create } from 'zustand'
import type { Profile, Workspace, Channel, Message, Todo, Contact } from '@/types/database'

export interface ActivityItem {
  id: string
  type: 'mention' | 'dm' | 'reaction' | 'thread_reply'
  message: Message
  channelId: string
  channelName: string
  timestamp: string
  read: boolean
}

interface AppState {
  user: Profile | null
  workspace: Workspace | null
  workspaceRole: 'owner' | 'admin' | 'member' | null
  channels: Channel[]
  dmChannels: (Channel & { otherUser?: Profile; memberProfiles?: Profile[] })[]
  currentChannelId: string | null
  previewChannel: Channel | null
  threadParentMessage: Message | null
  profileUserId: string | null
  activityOpen: boolean
  activities: ActivityItem[]
  unreadActivityCount: number
  hiddenDmIds: string[]
  unreadCounts: Record<string, number>
  mutedChannelIds: string[]
  sidebarOpen: boolean
  sidebarTab: 'chats' | 'workspaces'
  contacts: Contact[]
  pendingContacts: Contact[]
  personalWorkspace: Workspace | null
  todos: Todo[]
  todoView: 'board' | 'list'
  todoFilterChannel: string | null
  multiDeviceEnabled: boolean
  syncStartTime: string | null
  setUser: (user: Profile | null) => void
  setWorkspace: (workspace: Workspace | null) => void
  setWorkspaceRole: (role: 'owner' | 'admin' | 'member' | null) => void
  setPreviewChannel: (channel: Channel | null) => void
  setChannels: (channels: Channel[]) => void
  setDmChannels: (channels: (Channel & { otherUser?: Profile; memberProfiles?: Profile[] })[]) => void
  addChannel: (channel: Channel) => void
  removeChannel: (channelId: string) => void
  updateChannel: (channelId: string, updates: Partial<Channel>) => void
  addDmChannel: (channel: Channel & { otherUser?: Profile; memberProfiles?: Profile[] }) => void
  setCurrentChannelId: (id: string | null) => void
  openThread: (message: Message) => void
  closeThread: () => void
  openProfile: (userId: string) => void
  closeProfile: () => void
  toggleActivity: () => void
  closeActivity: () => void
  addActivity: (item: ActivityItem) => void
  markActivityRead: (id: string) => void
  markAllActivitiesRead: () => void
  hideDm: (channelId: string) => void
  unhideDm: (channelId: string) => void
  incrementUnread: (channelId: string) => void
  muteChannel: (channelId: string) => void
  unmuteChannel: (channelId: string) => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setSidebarTab: (tab: 'chats' | 'workspaces') => void
  setContacts: (contacts: Contact[]) => void
  addContact: (contact: Contact) => void
  removeContact: (contactId: string) => void
  setPendingContacts: (contacts: Contact[]) => void
  addPendingContact: (contact: Contact) => void
  removePendingContact: (contactId: string) => void
  acceptPendingContact: (contactId: string) => void
  setPersonalWorkspace: (ws: Workspace | null) => void
  setTodos: (todos: Todo[]) => void
  addTodo: (todo: Todo) => void
  updateTodo: (todoId: string, updates: Partial<Todo>) => void
  removeTodo: (todoId: string) => void
  setTodoView: (view: 'board' | 'list') => void
  setTodoFilterChannel: (channelId: string | null) => void
  setMultiDeviceEnabled: (enabled: boolean) => void
  setSyncStartTime: (time: string | null) => void
  activeCall: { roomName: string; serverUrl: string; token: string } | null
  setActiveCall: (call: { roomName: string; serverUrl: string; token: string } | null) => void
  signOut: () => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  workspace: null,
  workspaceRole: null,
  channels: [],
  dmChannels: [],
  currentChannelId: null,
  previewChannel: null,
  threadParentMessage: null,
  profileUserId: null,
  activityOpen: false,
  activities: [],
  unreadActivityCount: 0,
  hiddenDmIds: [],
  unreadCounts: {},
  mutedChannelIds: [],
  sidebarOpen: false,
  sidebarTab: 'chats',
  contacts: [],
  pendingContacts: [],
  personalWorkspace: null,
  todos: [],
  todoView: 'board',
  todoFilterChannel: null,
  multiDeviceEnabled: false,
  syncStartTime: null,
  activeCall: null,

  setUser: (user) => set({ user }),
  setActiveCall: (activeCall) => set({ activeCall }),
  setWorkspace: (workspace) => set({ workspace }),
  setWorkspaceRole: (workspaceRole) => set({ workspaceRole }),
  setPreviewChannel: (previewChannel) => set({ previewChannel, threadParentMessage: null, profileUserId: null }),
  setChannels: (channels) => set({ channels }),
  setDmChannels: (dmChannels) => set({ dmChannels }),
  addChannel: (channel) =>
    set((state) => ({
      channels: [...state.channels, channel].sort((a, b) => a.name.localeCompare(b.name)),
    })),
  removeChannel: (channelId) =>
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== channelId),
      currentChannelId: state.currentChannelId === channelId ? null : state.currentChannelId,
    })),
  updateChannel: (channelId, updates) =>
    set((state) => ({
      channels: state.channels.map((c) =>
        c.id === channelId ? { ...c, ...updates } : c
      ).sort((a, b) => a.name.localeCompare(b.name)),
    })),
  addDmChannel: (channel) =>
    set((state) => ({
      dmChannels: [...state.dmChannels.filter((c) => c.id !== channel.id), channel],
      hiddenDmIds: state.hiddenDmIds.filter((id) => id !== channel.id),
    })),
  setCurrentChannelId: (currentChannelId) => set((state) => {
    let readCount = 0
    const updatedActivities = state.activities.map((a) => {
      if (currentChannelId && a.channelId === currentChannelId && !a.read) {
        readCount++
        return { ...a, read: true }
      }
      return a
    })

    return {
      currentChannelId,
      previewChannel: null,
      threadParentMessage: null,
      profileUserId: null,
      unreadCounts: currentChannelId
        ? { ...state.unreadCounts, [currentChannelId]: 0 }
        : state.unreadCounts,
      activities: updatedActivities,
      unreadActivityCount: Math.max(0, state.unreadActivityCount - readCount),
    }
  }),
  openThread: (message) => set({ threadParentMessage: message, profileUserId: null }),
  closeThread: () => set({ threadParentMessage: null }),
  openProfile: (userId) => set({ profileUserId: userId, threadParentMessage: null }),
  closeProfile: () => set({ profileUserId: null }),
  toggleActivity: () => set((state) => ({
    activityOpen: !state.activityOpen,
    threadParentMessage: null,
    profileUserId: null,
  })),
  closeActivity: () => set({ activityOpen: false }),
  addActivity: (item) =>
    set((state) => ({
      activities: [item, ...state.activities].slice(0, 100),
      unreadActivityCount: state.activityOpen ? state.unreadActivityCount : state.unreadActivityCount + 1,
    })),
  markActivityRead: (id) => set((state) => {
    const found = state.activities.find((a) => a.id === id && !a.read)
    if (!found) return state
    return {
      activities: state.activities.map((a) => a.id === id ? { ...a, read: true } : a),
      unreadActivityCount: Math.max(0, state.unreadActivityCount - 1),
    }
  }),
  markAllActivitiesRead: () => set((state) => ({
    activities: state.activities.map((a) => ({ ...a, read: true })),
    unreadActivityCount: 0,
  })),
  hideDm: (channelId) =>
    set((state) => ({
      hiddenDmIds: [...state.hiddenDmIds, channelId],
      currentChannelId: state.currentChannelId === channelId ? null : state.currentChannelId,
    })),
  unhideDm: (channelId) =>
    set((state) => ({
      hiddenDmIds: state.hiddenDmIds.filter((id) => id !== channelId),
    })),
  incrementUnread: (channelId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [channelId]: (state.unreadCounts[channelId] || 0) + 1,
      },
    })),
  muteChannel: (channelId) =>
    set((state) => ({
      mutedChannelIds: [...state.mutedChannelIds, channelId],
    })),
  unmuteChannel: (channelId) =>
    set((state) => ({
      mutedChannelIds: state.mutedChannelIds.filter((id) => id !== channelId),
    })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setContacts: (contacts) => set({ contacts }),
  addContact: (contact) =>
    set((state) => ({
      contacts: [...state.contacts, contact],
    })),
  removeContact: (contactId) =>
    set((state) => ({
      contacts: state.contacts.filter((c) => c.id !== contactId),
    })),
  setPendingContacts: (pendingContacts) => set({ pendingContacts }),
  addPendingContact: (contact) =>
    set((state) => ({
      pendingContacts: [...state.pendingContacts, contact],
    })),
  removePendingContact: (contactId) =>
    set((state) => ({
      pendingContacts: state.pendingContacts.filter((c) => c.id !== contactId),
    })),
  acceptPendingContact: (contactId) =>
    set((state) => ({
      pendingContacts: state.pendingContacts.filter((c) => c.id !== contactId),
    })),
  setPersonalWorkspace: (personalWorkspace) => set({ personalWorkspace }),
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set(state => ({ todos: [...state.todos, todo] })),
  updateTodo: (todoId, updates) => set(state => ({
    todos: state.todos.map(t => t.id === todoId ? { ...t, ...updates } : t),
  })),
  removeTodo: (todoId) => set(state => ({
    todos: state.todos.filter(t => t.id !== todoId),
  })),
  setTodoView: (todoView) => set({ todoView }),
  setTodoFilterChannel: (todoFilterChannel) => set({ todoFilterChannel }),
  setMultiDeviceEnabled: (multiDeviceEnabled) => set({ multiDeviceEnabled }),
  setSyncStartTime: (syncStartTime) => set({ syncStartTime }),
  signOut: () =>
    set({
      user: null,
      workspace: null,
      workspaceRole: null,
      channels: [],
      dmChannels: [],
      currentChannelId: null,
      previewChannel: null,
      threadParentMessage: null,
      profileUserId: null,
      activityOpen: false,
      activities: [],
      unreadActivityCount: 0,
      hiddenDmIds: [],
      unreadCounts: {},
      mutedChannelIds: [],
      sidebarOpen: false,
      sidebarTab: 'chats',
      contacts: [],
      pendingContacts: [],
      personalWorkspace: null,
      todos: [],
      todoView: 'board',
      todoFilterChannel: null,
      multiDeviceEnabled: false,
      syncStartTime: null,
      activeCall: null,
    }),
}))
