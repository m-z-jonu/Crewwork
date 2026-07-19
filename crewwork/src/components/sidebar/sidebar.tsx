'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store/app-store'
import { getSupabaseClient } from '@/lib/supabase/client'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Hash,
  Lock,
  Plus,
  LogOut,
  ChevronDown,
  ChevronRight,
  Circle,
  UserPlus,
  Search,
  PenSquare,
  Bell,
  BellOff,
  X,
  Compass,

  CheckSquare,
  Users,
  User,
  MessageCircle,
  Bookmark,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CreateChannelDialog } from './create-channel-dialog'
import { DmDialog } from './dm-dialog'
import { CreateGroupDialog } from './create-group-dialog'
import { BrowseChannelsDialog } from './browse-channels-dialog'
import { InviteDialog } from '@/components/workspace/invite-dialog'
import { WorkspaceSettingsDialog } from '@/components/workspace/workspace-settings-dialog'
import { WorkspacePersonalSettings } from '@/components/workspace/workspace-personal-settings'
import { SearchDialog } from '@/components/search/search-dialog'
import { ProfileEditDialog } from '@/components/profile/profile-edit-dialog'

import { TodosPanel } from '@/components/todos/todos-panel'
import { ContactsPanel } from '@/components/contacts/contacts-panel'
import { BookmarksPanel } from '@/components/bookmarks/bookmarks-panel'
import { ChannelSettingsDialog } from '@/components/chat/channel-settings-dialog'
import type { Profile, Channel } from '@/types/database'

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const router = useRouter()
  const user = useAppStore((s) => s.user)
  const workspace = useAppStore((s) => s.workspace)
  const channels = useAppStore((s) => s.channels)
  const dmChannels = useAppStore((s) => s.dmChannels)
  const currentChannelId = useAppStore((s) => s.currentChannelId)
  const setCurrentChannelId = useAppStore((s) => s.setCurrentChannelId)
  const setDmChannels = useAppStore((s) => s.setDmChannels)
  const toggleActivity = useAppStore((s) => s.toggleActivity)
  const unreadActivityCount = useAppStore((s) => s.unreadActivityCount)
  const hiddenDmIds = useAppStore((s) => s.hiddenDmIds)
  const hideDm = useAppStore((s) => s.hideDm)
  const unreadCounts = useAppStore((s) => s.unreadCounts)
  const mutedChannelIds = useAppStore((s) => s.mutedChannelIds)
  const muteChannel = useAppStore((s) => s.muteChannel)
  const unmuteChannel = useAppStore((s) => s.unmuteChannel)
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const contacts = useAppStore((s) => s.contacts)
  const pendingContacts = useAppStore((s) => s.pendingContacts)
  const personalWorkspace = useAppStore((s) => s.personalWorkspace)
  const [channelsOpen, setChannelsOpen] = useState(true)
  const [dmsOpen, setDmsOpen] = useState(true)
  const [contactsOpen, setContactsOpen] = useState(true)
  const [groupsOpen, setGroupsOpen] = useState(true)
  const [createChannelOpen, setCreateChannelOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [dmDialogOpen, setDmDialogOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileEditOpen, setProfileEditOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false)
  const [personalSettingsOpen, setPersonalSettingsOpen] = useState(false)
  const [todosOpen, setTodosOpen] = useState(false)
  const [contactsPanelOpen, setContactsPanelOpen] = useState(false)
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false)
  const [channelSettingsChannel, setChannelSettingsChannel] = useState<Channel | null>(null)

  // Load DM channels + subscribe to new DMs + track unread in real-time
  useEffect(() => {
    const activeWorkspace = sidebarTab === 'chats' ? personalWorkspace : workspace
    if (!activeWorkspace || !user) return
    const client = getSupabaseClient()
    if (!client) return

    async function loadDms() {
      const { data: myChannels } = await client!
        .from('channel_members')
        .select('channel_id')
        .eq('profile_id', user!.id)

      if (!myChannels) return

      const channelIds = myChannels.map((c) => c.channel_id)
      if (channelIds.length === 0) return

      const { data: dms } = await client!
        .from('channels')
        .select('*')
        .eq('workspace_id', activeWorkspace!.id)
        .or('name.like.dm-%,name.like.gdm-%')
        .in('id', channelIds)

      if (!dms || dms.length === 0) return

      const dmWithUsers: (Channel & { otherUser?: Profile; memberProfiles?: Profile[] })[] = []

      for (const dm of dms) {
        const { data: members } = await client!
          .from('channel_members')
          .select('profile_id, profile:profiles(*)')
          .eq('channel_id', dm.id)

        if (dm.name.startsWith('gdm-')) {
          const otherMembers = members
            ?.filter(m => m.profile_id !== user!.id)
            .map(m => m.profile as unknown as Profile)
            .filter(Boolean) || []
          dmWithUsers.push({
            ...dm,
            memberProfiles: otherMembers,
          })
        } else {
          const other = members?.find((m) => m.profile_id !== user!.id)
          dmWithUsers.push({
            ...dm,
            otherUser: other?.profile as unknown as Profile | undefined,
          })
        }
      }

      setDmChannels(dmWithUsers)
    }

    loadDms()

    const newMsgSub = client
      .channel('sidebar-dm-watcher')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const msg = payload.new as { channel_id: string; sender_id: string }
          if (msg.sender_id === user!.id) return

          const state = useAppStore.getState()

          if (msg.channel_id !== state.currentChannelId) {
            const isKnownChannel =
              state.channels.some((c) => c.id === msg.channel_id) ||
              state.dmChannels.some((d) => d.id === msg.channel_id)
            if (isKnownChannel) {
              state.incrementUnread(msg.channel_id)
            }
          }

          if (state.dmChannels.some((d) => d.id === msg.channel_id)) return

          const { data: ch } = await client!
            .from('channels')
            .select('*')
            .eq('id', msg.channel_id)
            .or('name.like.dm-%,name.like.gdm-%')
            .single()

          if (!ch) return

          const { data: membership } = await client!
            .from('channel_members')
            .select('profile_id')
            .eq('channel_id', ch.id)
            .eq('profile_id', user!.id)
            .single()

          if (!membership) return

          const { data: members } = await client!
            .from('channel_members')
            .select('profile_id, profile:profiles(*)')
            .eq('channel_id', ch.id)

          if (ch.name.startsWith('gdm-')) {
            const otherMembers = members
              ?.filter((m) => m.profile_id !== user!.id)
              .map(m => m.profile as unknown as Profile)
              .filter(Boolean) || []
            useAppStore.getState().addDmChannel({
              ...ch,
              memberProfiles: otherMembers,
            })
          } else {
            const other = members?.find((m) => m.profile_id !== user!.id)
            useAppStore.getState().addDmChannel({
              ...ch,
              otherUser: other?.profile as unknown as Profile | undefined,
            })
          }
        }
      )
      .subscribe()

    const membershipSub = client
      .channel('sidebar-membership-watcher')
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'channel_members' },
        (payload) => {
          const old = payload.old as { channel_id?: string; profile_id?: string }
          if (old.profile_id === user!.id && old.channel_id) {
            const state = useAppStore.getState()
            const isDm = state.dmChannels.some((d) => d.id === old.channel_id)
            if (isDm) {
              state.setDmChannels(state.dmChannels.filter((d) => d.id !== old.channel_id))
            } else {
              state.removeChannel(old.channel_id!)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channel_members' },
        async (payload) => {
          const row = payload.new as { channel_id: string; profile_id: string; role: string }
          if (row.profile_id !== user!.id) return

          const state = useAppStore.getState()
          if (state.channels.some((c) => c.id === row.channel_id)) return
          if (state.dmChannels.some((d) => d.id === row.channel_id)) return

          const { data: ch } = await client!
            .from('channels')
            .select('*')
            .eq('id', row.channel_id)
            .single()

          if (!ch) return

          if (ch.name.startsWith('dm-') || ch.name.startsWith('gdm-')) {
            const { data: members } = await client!
              .from('channel_members')
              .select('profile_id, profile:profiles(*)')
              .eq('channel_id', ch.id)

            if (ch.name.startsWith('gdm-')) {
              const otherMembers = members
                ?.filter((m) => m.profile_id !== user!.id)
                .map(m => m.profile as unknown as Profile)
                .filter(Boolean) || []
              useAppStore.getState().addDmChannel({
                ...ch,
                memberProfiles: otherMembers,
              })
            } else {
              const other = members?.find((m) => m.profile_id !== user!.id)
              useAppStore.getState().addDmChannel({
                ...ch,
                otherUser: other?.profile as unknown as Profile | undefined,
              })
            }
          } else {
            useAppStore.getState().addChannel(ch as Channel)
          }
        }
      )
      .subscribe()

    return () => {
      newMsgSub.unsubscribe()
      membershipSub.unsubscribe()
    }
  }, [workspace, personalWorkspace, sidebarTab, setDmChannels, user])

  // Keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function handleSignOut() {
    const client = getSupabaseClient()
    if (client) {
      await client.auth.signOut()
    }
    useAppStore.getState().signOut()
    router.push('/auth')
  }

  const regularChannels = useMemo(() => channels.filter((c) => !c.name.startsWith('dm-') && !c.name.startsWith('gdm-')), [channels])
  const sortedChannels = useMemo(() => [...regularChannels].sort((a, b) => {
    const aMuted = mutedChannelIds.includes(a.id)
    const bMuted = mutedChannelIds.includes(b.id)
    if (aMuted !== bMuted) return aMuted ? 1 : -1
    return a.name.localeCompare(b.name)
  }), [regularChannels, mutedChannelIds])

  // Separate DMs and groups
  const personalDms = useMemo(() => dmChannels.filter((d) => d.name.startsWith('dm-') && !hiddenDmIds.includes(d.id)), [dmChannels, hiddenDmIds])
  const personalGroups = useMemo(() => dmChannels.filter((d) => d.name.startsWith('gdm-') && !hiddenDmIds.includes(d.id)), [dmChannels, hiddenDmIds])

  const activeWsName = sidebarTab === 'chats'
    ? (personalWorkspace?.personal_name || 'Personal')
    : (workspace?.name || 'CrewWork')

  const activeWsIcon = sidebarTab === 'chats'
    ? (personalWorkspace?.personal_name?.[0]?.toUpperCase() || 'P')
    : (workspace?.name?.[0]?.toUpperCase() || 'C')

  return (
    <>
      <div className="w-[260px] flex flex-col h-full" style={{ background: '#FEF2F2', borderRight: '1px solid #FECACA' }}>
        {/* Workspace header */}
        <div className="px-4 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid #FECACA' }}>
          <button
            onClick={() => sidebarTab === 'chats' ? setPersonalSettingsOpen(true) : setWorkspaceSettingsOpen(true)}
            className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          >
            <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: '#DC2626' }}>
              {activeWsIcon}
            </div>
            <span className="font-[800] text-[16px] truncate" style={{ color: '#1C1917' }}>{activeWsName}</span>
          </button>
          <button
            onClick={() => sidebarTab === 'chats' ? setCreateGroupOpen(true) : setDmDialogOpen(true)}
            className="h-8 w-8 rounded-lg flex items-center justify-center transition-all hover:bg-[#FECACA]"
          >
            <PenSquare className="h-4 w-4" style={{ color: '#A8A29E' }} />
          </button>
        </div>

        {/* Tab bar: Chats / Workspaces */}
        <div className="flex px-3 pt-3 pb-1 gap-1">
          <button
            onClick={() => setSidebarTab('chats')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-medium transition-all relative',
              sidebarTab === 'chats'
                ? 'text-white shadow-sm'
                : 'hover:bg-[#FECACA]'
            )}
            style={{
              background: sidebarTab === 'chats' ? '#DC2626' : undefined,
              color: sidebarTab === 'chats' ? '#fff' : '#78716C',
            }}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Chats
            {pendingContacts.length > 0 && (
              <span
                className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                style={{ background: '#F59E0B' }}
              >
                {pendingContacts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setSidebarTab('workspaces')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-medium transition-all',
              sidebarTab === 'workspaces'
                ? 'text-white shadow-sm'
                : 'hover:bg-[#FECACA]'
            )}
            style={{
              background: sidebarTab === 'workspaces' ? '#DC2626' : undefined,
              color: sidebarTab === 'workspaces' ? '#fff' : '#78716C',
            }}
          >
            <Users className="h-3.5 w-3.5" />
            Workspaces
          </button>
        </div>

        {/* Search bar */}
        <div className="px-3 pt-2 pb-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-[13px] hover:shadow-sm"
            style={{ background: '#ffffff', color: '#A8A29E', border: '1px solid #E7E5E4' }}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded-md font-mono" style={{ background: '#FEF2F2', color: '#A8A29E' }}>⌘K</kbd>
          </button>
        </div>

        {sidebarTab === 'chats' ? (
          /* ==================== CHATS TAB ==================== */
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 pt-3 pb-2">
              {/* Contacts section */}
              <div className="flex items-center justify-between px-2 py-0.5 mb-0.5">
                <button
                  onClick={() => setContactsOpen(!contactsOpen)}
                  className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider transition-colors hover:text-[#1C1917]"
                  style={{ color: '#A8A29E' }}
                >
                  {contactsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Contacts
                </button>
                <button
                  className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:bg-[#FECACA]"
                  onClick={() => setContactsPanelOpen(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
                </button>
              </div>

              {contactsOpen && (
                <div className="space-y-0.5">
                  {contacts.length === 0 ? (
                    <button
                      onClick={() => setContactsPanelOpen(true)}
                      className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                      style={{ color: '#A8A29E' }}
                    >
                      <UserPlus className="h-4 w-4 shrink-0" />
                      <span>Add contacts</span>
                    </button>
                  ) : (
                    contacts.slice(0, 8).map((contact) => {
                      const profile = contact.contact_profile
                      if (!profile) return null
                      const initial = profile.display_name[0]?.toUpperCase() || '?'
                      return (
                        <button
                          key={contact.id}
                          onClick={() => {
                            // Start DM with contact
                            if (personalWorkspace) {
                              const ids = [user!.id, profile.id].sort()
                              const dmName = `dm-${ids[0].slice(0, 8)}-${ids[1].slice(0, 8)}`
                              // Find existing DM or trigger create
                              const existingDm = dmChannels.find(d => d.name === dmName)
                              if (existingDm) {
                                setCurrentChannelId(existingDm.id)
                                onNavigate?.()
                              } else {
                                setContactsPanelOpen(true)
                              }
                            }
                          }}
                          className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                          style={{ color: '#78716C' }}
                        >
                          <div className="relative shrink-0">
                            {profile.avatar_url ? (
                              <img src={profile.avatar_url} alt="" className="h-5 w-5 rounded-md object-cover" />
                            ) : (
                              <div className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ background: '#FECACA', color: '#DC2626' }}>
                                {initial}
                              </div>
                            )}
                            <Circle
                              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${profile.is_online ? 'fill-green-500 text-green-500' : 'fill-gray-300 text-gray-300'}`}
                              strokeWidth={3}
                              stroke="#FEF2F2"
                            />
                          </div>
                          <span className="truncate flex-1 text-left">{profile.display_name}</span>
                        </button>
                      )
                    })
                  )}
                  {contacts.length > 8 && (
                    <button
                      onClick={() => setContactsPanelOpen(true)}
                      className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[12px] transition-all hover:bg-[#FECACA]"
                      style={{ color: '#A8A29E' }}
                    >
                      View all {contacts.length} contacts
                    </button>
                  )}
                </div>
              )}

              {/* Groups section */}
              <div className="flex items-center justify-between px-2 py-0.5 mt-4 mb-0.5">
                <button
                  onClick={() => setGroupsOpen(!groupsOpen)}
                  className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider transition-colors hover:text-[#1C1917]"
                  style={{ color: '#A8A29E' }}
                >
                  {groupsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Groups
                </button>
                <button
                  className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:bg-[#FECACA]"
                  onClick={() => setCreateGroupOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
                </button>
              </div>

              {groupsOpen && (
                <div className="space-y-0.5">
                  {personalGroups.length === 0 ? (
                    <button
                      onClick={() => setCreateGroupOpen(true)}
                      className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                      style={{ color: '#A8A29E' }}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      <span>Create a group</span>
                    </button>
                  ) : (
                    personalGroups.map((group) => {
                      const isGroupDm = group.name.startsWith('gdm-')
                      const otherName = (group.memberProfiles || []).map(m => m.display_name).join(', ') || 'Group'
                      const isActive = currentChannelId === group.id
                      const unreadCount = unreadCounts[group.id] || 0

                      return (
                        <button
                          key={group.id}
                          onClick={() => { setCurrentChannelId(group.id); onNavigate?.() }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all',
                            isActive
                              ? 'text-white font-semibold shadow-sm'
                              : unreadCount > 0
                                ? 'hover:bg-[#FECACA] font-semibold'
                                : 'hover:bg-[#FECACA]'
                          )}
                          style={{
                            background: isActive ? '#DC2626' : undefined,
                            color: isActive ? '#fff' : '#78716C',
                          }}
                        >
                          <Users className={cn('h-4 w-4 shrink-0', isActive ? 'opacity-70' : 'opacity-50')} />
                          <span className="truncate flex-1 text-left">{otherName}</span>
                          {unreadCount > 0 && !isActive && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white min-w-[18px] text-center shrink-0" style={{ background: '#DC2626' }}>
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              )}

              {/* DMs section */}
              <div className="flex items-center justify-between px-2 py-0.5 mt-4 mb-0.5">
                <button
                  onClick={() => setDmsOpen(!dmsOpen)}
                  className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider transition-colors hover:text-[#1C1917]"
                  style={{ color: '#A8A29E' }}
                >
                  {dmsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Messages
                </button>
                <button
                  className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:bg-[#FECACA]"
                  onClick={() => setContactsPanelOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
                </button>
              </div>

              {dmsOpen && (
                <div className="space-y-0.5">
                  {personalDms.length === 0 ? (
                    <button
                      onClick={() => setContactsPanelOpen(true)}
                      className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                      style={{ color: '#A8A29E' }}
                    >
                      <MessageCircle className="h-4 w-4 shrink-0" />
                      <span>Start a conversation</span>
                    </button>
                  ) : (
                    personalDms.map((dm) => {
                      const otherName = dm.otherUser?.display_name || 'Unknown'
                      const initial = dm.otherUser?.display_name?.[0]?.toUpperCase() || '?'
                      const isOnline = dm.otherUser?.is_online ?? false
                      const isActive = currentChannelId === dm.id
                      const unreadCount = unreadCounts[dm.id] || 0

                      return (
                        <div key={dm.id} className="group relative">
                          <button
                            onClick={() => { setCurrentChannelId(dm.id); onNavigate?.() }}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all',
                              isActive
                                ? 'text-white font-semibold shadow-sm'
                                : unreadCount > 0
                                  ? 'hover:bg-[#FECACA] font-semibold'
                                  : 'hover:bg-[#FECACA]'
                            )}
                            style={{
                              background: isActive ? '#DC2626' : undefined,
                              color: isActive ? '#fff' : '#78716C',
                            }}
                          >
                            <div className="relative shrink-0">
                              {dm.otherUser?.avatar_url ? (
                                <img src={dm.otherUser.avatar_url} alt="" className="h-5 w-5 rounded-md object-cover" />
                              ) : (
                                <div className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ background: isActive ? 'rgba(255,255,255,0.25)' : '#FECACA', color: isActive ? '#fff' : '#DC2626' }}>
                                  {initial}
                                </div>
                              )}
                              <Circle
                                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${isOnline ? 'fill-green-500 text-green-500' : 'fill-gray-300 text-gray-300'}`}
                                strokeWidth={3}
                                stroke={isActive ? '#DC2626' : '#FEF2F2'}
                              />
                            </div>
                            <span className="truncate flex-1 text-left">{otherName}</span>
                            {unreadCount > 0 && !isActive && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white min-w-[18px] text-center shrink-0" style={{ background: '#DC2626' }}>
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); hideDm(dm.id) }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#FECACA]"
                            title="Close conversation"
                            style={{ color: '#A8A29E' }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          /* ==================== WORKSPACES TAB ==================== */
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 pt-3 pb-2">
              {/* Activity button */}
              <div className="pb-1">
                <button
                  onClick={toggleActivity}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-[13px] hover:shadow-sm relative"
                  style={{ background: '#ffffff', color: '#78716C', border: '1px solid #E7E5E4' }}
                >
                  <Bell className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />
                  <span className="flex-1 text-left font-medium">Activity</span>
                  {unreadActivityCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white min-w-[18px] text-center" style={{ background: '#E55B5B' }}>
                      {unreadActivityCount > 99 ? '99+' : unreadActivityCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Todos button */}
              <div className="pb-1">
                <button
                  onClick={() => setTodosOpen(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-[13px] hover:shadow-sm"
                  style={{ background: '#ffffff', color: '#78716C', border: '1px solid #E7E5E4' }}
                >
                  <CheckSquare className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />
                  <span className="flex-1 text-left font-medium">Todos</span>
                </button>
              </div>

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

              {/* Channels section */}
              <div className="flex items-center justify-between px-2 py-0.5 mt-4 mb-0.5">
                <button
                  onClick={() => setChannelsOpen(!channelsOpen)}
                  className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider transition-colors hover:text-[#1C1917]"
                  style={{ color: '#A8A29E' }}
                >
                  {channelsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Channels
                </button>
                <button
                  className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:bg-[#FECACA]"
                  onClick={() => setCreateChannelOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
                </button>
              </div>

              {channelsOpen && (
                <div className="space-y-0.5">
                  {sortedChannels.map((channel) => {
                    const isActive = currentChannelId === channel.id
                    const isMuted = mutedChannelIds.includes(channel.id)
                    const unreadCount = unreadCounts[channel.id] || 0

                    return (
                      <div key={channel.id} className="group relative">
                        <button
                          onClick={() => { setCurrentChannelId(channel.id); onNavigate?.() }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all',
                            isActive
                              ? 'text-white font-semibold shadow-sm'
                              : 'hover:bg-[#FECACA]'
                          )}
                          style={{
                            background: isActive ? '#DC2626' : undefined,
                            color: isActive ? '#fff' : isMuted ? '#A9A6B8' : '#78716C',
                          }}
                        >
                          {channel.is_private ? (
                            <Lock className={cn('h-3.5 w-3.5 shrink-0', isMuted && !isActive ? 'opacity-40' : 'opacity-70')} />
                          ) : (
                            <Hash className={cn('h-4 w-4 shrink-0', isMuted && !isActive ? 'opacity-40' : 'opacity-70')} />
                          )}
                          <span className={cn('truncate flex-1 text-left', isMuted && !isActive && 'opacity-60')}>
                            {channel.name}
                          </span>
                          {isMuted && !isActive && (
                            <BellOff className="h-3 w-3 shrink-0 opacity-30" />
                          )}
                          {unreadCount > 0 && !isActive && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white min-w-[18px] text-center shrink-0" style={{ background: isMuted ? '#A9A6B8' : '#DC2626' }}>
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setChannelSettingsChannel(channel)
                            }}
                            className="h-5 w-5 rounded flex items-center justify-center hover:bg-[#FECACA]"
                            title="Channel settings"
                            style={{ color: '#A8A29E' }}
                          >
                            <Settings className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              isMuted ? unmuteChannel(channel.id) : muteChannel(channel.id)
                            }}
                            className="h-5 w-5 rounded flex items-center justify-center hover:bg-[#FECACA]"
                            title={isMuted ? 'Unmute channel' : 'Mute channel'}
                            style={{ color: '#A8A29E' }}
                          >
                            {isMuted ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  <button
                    onClick={() => setBrowseOpen(true)}
                    className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                    style={{ color: '#A8A29E' }}
                  >
                    <Compass className="h-4 w-4 shrink-0" />
                    <span>Browse channels</span>
                  </button>
                </div>
              )}

              {/* Direct Messages section */}
              <div className="flex items-center justify-between px-2 py-0.5 mt-4 mb-0.5">
                <button
                  onClick={() => setDmsOpen(!dmsOpen)}
                  className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider transition-colors hover:text-[#1C1917]"
                  style={{ color: '#A8A29E' }}
                >
                  {dmsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Direct Messages
                </button>
                <button
                  className="h-6 w-6 rounded-md flex items-center justify-center transition-all hover:bg-[#FECACA]"
                  onClick={() => setDmDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" style={{ color: '#A8A29E' }} />
                </button>
              </div>

              {dmsOpen && (
                <div className="space-y-0.5">
                  {dmChannels
                    .filter((dm) => !hiddenDmIds.includes(dm.id))
                    .map((dm) => {
                      const isGroupDm = dm.name.startsWith('gdm-')
                      const otherName = isGroupDm
                        ? (dm.memberProfiles || []).map(m => m.display_name).join(', ') || 'Group DM'
                        : dm.otherUser?.display_name || 'Unknown'
                      const initial = isGroupDm
                        ? (dm.memberProfiles?.[0]?.display_name?.[0]?.toUpperCase() || 'G')
                        : (dm.otherUser?.display_name?.[0]?.toUpperCase() || '?')
                      const isOnline = isGroupDm
                        ? (dm.memberProfiles || []).some(m => m.is_online)
                        : (dm.otherUser?.is_online ?? false)
                      const isActive = currentChannelId === dm.id
                      const unreadCount = unreadCounts[dm.id] || 0

                      return (
                        <div key={dm.id} className="group relative">
                          <button
                            onClick={() => { setCurrentChannelId(dm.id); onNavigate?.() }}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all',
                              isActive
                                ? 'text-white font-semibold shadow-sm'
                                : unreadCount > 0
                                  ? 'hover:bg-[#FECACA] font-semibold'
                                  : 'hover:bg-[#FECACA]'
                            )}
                            style={{
                              background: isActive ? '#DC2626' : undefined,
                              color: isActive ? '#fff' : '#78716C',
                            }}
                          >
                            {isGroupDm ? (
                              <div className="relative shrink-0 w-5 h-5">
                                {dm.memberProfiles?.[0]?.avatar_url ? (
                                  <img src={dm.memberProfiles[0].avatar_url} alt="" className="absolute top-0 left-0 h-3.5 w-3.5 rounded-sm object-cover border" style={{ borderColor: isActive ? '#DC2626' : '#FEF2F2' }} />
                                ) : (
                                  <div className="absolute top-0 left-0 h-3.5 w-3.5 rounded-sm flex items-center justify-center text-[7px] font-bold border" style={{ background: isActive ? 'rgba(255,255,255,0.25)' : '#FECACA', color: isActive ? '#fff' : '#DC2626', borderColor: isActive ? '#DC2626' : '#FEF2F2' }}>
                                    {dm.memberProfiles?.[0]?.display_name?.[0]?.toUpperCase() || '?'}
                                  </div>
                                )}
                                {dm.memberProfiles?.[1]?.avatar_url ? (
                                  <img src={dm.memberProfiles[1].avatar_url} alt="" className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-sm object-cover border" style={{ borderColor: isActive ? '#DC2626' : '#FEF2F2' }} />
                                ) : (
                                  <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-sm flex items-center justify-center text-[7px] font-bold border" style={{ background: isActive ? 'rgba(255,255,255,0.35)' : '#D6CBFF', color: isActive ? '#fff' : '#DC2626', borderColor: isActive ? '#DC2626' : '#FEF2F2' }}>
                                    {dm.memberProfiles?.[1]?.display_name?.[0]?.toUpperCase() || (dm.memberProfiles && dm.memberProfiles.length > 1 ? '+' : '?')}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="relative shrink-0">
                                {dm.otherUser?.avatar_url ? (
                                  <img src={dm.otherUser.avatar_url} alt="" className="h-5 w-5 rounded-md object-cover" />
                                ) : (
                                  <div className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ background: isActive ? 'rgba(255,255,255,0.25)' : '#FECACA', color: isActive ? '#fff' : '#DC2626' }}>
                                    {initial}
                                  </div>
                                )}
                                <Circle
                                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 ${isOnline ? 'fill-green-500 text-green-500' : 'fill-gray-300 text-gray-300'}`}
                                  strokeWidth={3}
                                  stroke={isActive ? '#DC2626' : '#FEF2F2'}
                                />
                              </div>
                            )}
                            <span className="truncate flex-1 text-left">{otherName}</span>
                            {unreadCount > 0 && !isActive && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white min-w-[18px] text-center shrink-0" style={{ background: '#DC2626' }}>
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            )}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); hideDm(dm.id) }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#FECACA]"
                            title="Close conversation"
                            style={{ color: '#A8A29E' }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })}

                  {dmChannels.filter((dm) => !hiddenDmIds.includes(dm.id)).length === 0 && (
                    <button
                      onClick={() => setDmDialogOpen(true)}
                      className="w-full flex items-center gap-2 px-3 py-[6px] rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                      style={{ color: '#A8A29E' }}
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      <span>Start a conversation</span>
                    </button>
                  )}
                </div>
              )}

              {/* Invite members button */}
              <button
                onClick={() => setInviteOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-[6px] mt-5 rounded-lg text-[14px] transition-all hover:bg-[#FECACA]"
                style={{ color: '#A8A29E' }}
              >
                <UserPlus className="h-4 w-4 shrink-0" />
                <span>Invite people</span>
              </button>
            </div>
          </ScrollArea>
        )}

        {/* User footer */}
        <div className="px-3 py-3" style={{ borderTop: '1px solid #FECACA' }}>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setProfileEditOpen(true)}
              className="flex items-center gap-2.5 min-w-0 hover:bg-[#FECACA] rounded-xl px-2 py-1.5 -mx-2 transition-all"
            >
              <div className="relative shrink-0">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt={user.display_name} className="h-9 w-9 rounded-xl object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold text-white" style={{ background: '#DC2626' }}>
                    {user?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-green-500 text-green-500 stroke-[3]" stroke="#FEF2F2" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[13px] font-semibold truncate" style={{ color: '#1C1917' }}>{user?.display_name}</p>
                {user?.status_emoji && (
                  <p className="text-[11px] truncate" style={{ color: '#A8A29E' }}>
                    {user.status_emoji} {user.status_text || ''}
                  </p>
                )}
              </div>
            </button>
            <button
              className="h-8 w-8 rounded-lg flex items-center justify-center transition-all hover:bg-[#FECACA]"
              onClick={handleSignOut}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" style={{ color: '#A8A29E' }} />
            </button>
          </div>
        </div>
      </div>

      <CreateChannelDialog open={createChannelOpen} onOpenChange={setCreateChannelOpen} />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <DmDialog open={dmDialogOpen} onOpenChange={setDmDialogOpen} />
      <CreateGroupDialog open={createGroupOpen} onOpenChange={setCreateGroupOpen} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ProfileEditDialog open={profileEditOpen} onOpenChange={setProfileEditOpen} />
      <BrowseChannelsDialog open={browseOpen} onOpenChange={setBrowseOpen} />
      <WorkspaceSettingsDialog open={workspaceSettingsOpen} onOpenChange={setWorkspaceSettingsOpen} />
      <WorkspacePersonalSettings open={personalSettingsOpen} onOpenChange={setPersonalSettingsOpen} />
      <TodosPanel open={todosOpen} onClose={() => setTodosOpen(false)} />
      <ContactsPanel open={contactsPanelOpen} onClose={() => setContactsPanelOpen(false)} />
      <BookmarksPanel open={bookmarksPanelOpen} onClose={() => setBookmarksPanelOpen(false)} />
      {channelSettingsChannel && (
        <ChannelSettingsDialog
          open={!!channelSettingsChannel}
          onOpenChange={(open) => { if (!open) setChannelSettingsChannel(null) }}
          channel={channelSettingsChannel}
        />
      )}
    </>
  )
}
