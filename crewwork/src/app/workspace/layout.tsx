'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import { Sidebar } from '@/components/sidebar/sidebar'
import { ActivityPanel } from '@/components/activity/activity-panel'
import { CallPanel } from '@/components/calls/call-panel'
import { IncomingCallBanner } from '@/components/calls/incoming-call-banner'
import { WorkspaceSetup } from '@/components/workspace/workspace-setup'
import type { Profile, Workspace, WorkspaceMember, Channel, Contact } from '@/types/database'
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/hooks/use-notifications'
import { usePresence } from '@/hooks/use-presence'
import { generateIdentityKeyPair, getIdentityKeyPair } from '@/lib/crypto/keys'

import { useMobile } from '@/hooks/use-mobile'

// Simple toast helper
function showToast(message: string) {
  const event = new CustomEvent('show-toast', { detail: { message } })
  window.dispatchEvent(event)
}

// Toast component for contact requests
function ContactRequestToast() {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([])

  useEffect(() => {
    function handleToast(e: Event) {
      const detail = (e as CustomEvent).detail
      const id = Date.now()
      setToasts((prev) => [...prev, { id, message: detail.message }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    }
    window.addEventListener('show-toast', handleToast)
    return () => window.removeEventListener('show-toast', handleToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="px-4 py-3 rounded-xl shadow-lg text-[13px] font-medium animate-in slide-in-from-right duration-200"
          style={{ background: '#1C1917', color: '#fff', minWidth: '250px' }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, workspace, setUser, setWorkspace, setWorkspaceRole, setChannels, setCurrentChannelId, sidebarOpen, setSidebarOpen, personalWorkspace, setPersonalWorkspace, setContacts, setPendingContacts } = useAppStore()
  const { isMobile, isTablet, isDesktop } = useMobile()
  const [loading, setLoading] = useState(true)
  const [showWorkspaceSetup, setShowWorkspaceSetup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useNotifications()
  usePresence()

  useEffect(() => {
    loadUserData()
    fetch('/api/storage', { method: 'POST' }).catch(() => {})
  }, [])

  async function loadUserData() {
    const client = getSupabaseClient()
    if (!client) {
      setError('Supabase client not configured. Please visit /setup.')
      setLoading(false)
      return
    }

    try {
      const { data: { user: authUser }, error: authError } = await client.auth.getUser()

      if (authError || !authUser) {
        router.push('/auth')
        return
      }

      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single()

      if (profileError || !profile) {
        setError(
          profileError?.code === 'PGRST116'
            ? 'Profile not found. Please sign out and sign in again, or contact support.'
            : `Failed to load profile: ${profileError?.message || 'Unknown error'}`
        )
        setLoading(false)
        return
      }

      setUser(profile as Profile)

      // Generate identity key for E2EE if not exists
      try {
        const existingKey = await getIdentityKeyPair()
        if (!existingKey) {
          await generateIdentityKeyPair()
        }
      } catch (keyError) {
        console.error('Identity key generation failed:', keyError)
      }

      // Load or create personal workspace
      await loadOrCreatePersonalWorkspace(authUser.id)

      // Find business workspace membership
      const { data: members, error: membersError } = await client
        .from('workspace_members')
        .select('*, workspace:workspaces(*)')
        .eq('profile_id', authUser.id)

      if (membersError) {
        setError(`Failed to load workspace: ${membersError.message}`)
        setLoading(false)
        return
      }

      // Find the first business workspace
      const businessMember = members?.find(
        (m) => (m.workspace as Workspace).workspace_type === 'business'
      ) as (WorkspaceMember & { workspace: Workspace }) | undefined

      if (businessMember?.workspace) {
        setWorkspace(businessMember.workspace)
        setWorkspaceRole(businessMember.role)
        await loadChannels(businessMember.workspace.id)
      } else {
        setShowWorkspaceSetup(true)
      }

      // Load contacts
      await loadContacts(authUser.id)
    } catch (err) {
      console.error('Failed to load user data:', err)
      setError(`Unexpected error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function loadOrCreatePersonalWorkspace(userId: string) {
    const client = getSupabaseClient()
    if (!client) return

    // Look for existing personal workspace
    const { data: members } = await client
      .from('workspace_members')
      .select('*, workspace:workspaces(*)')
      .eq('profile_id', userId)

    const personalMember = members?.find(
      (m) => (m.workspace as Workspace).workspace_type === 'personal'
    ) as (WorkspaceMember & { workspace: Workspace }) | undefined

    if (personalMember?.workspace) {
      setPersonalWorkspace(personalMember.workspace)
      return
    }

    // Create personal workspace if it doesn't exist
    try {
      const wsId = crypto.randomUUID()
      const slug = `personal-${userId.slice(0, 8)}`

      const { error: wsError } = await client
        .from('workspaces')
        .insert({
          id: wsId,
          name: 'Personal',
          slug,
          workspace_type: 'personal',
        })

      if (wsError) throw wsError

      // Add self as owner
      await client.from('workspace_members').insert({
        workspace_id: wsId,
        profile_id: userId,
        role: 'owner',
      })

      // Fetch the workspace
      const { data: ws } = await client
        .from('workspaces')
        .select('*')
        .eq('id', wsId)
        .single()

      if (ws) {
        setPersonalWorkspace(ws as Workspace)
      }
    } catch (err) {
      console.error('Failed to create personal workspace:', err)
    }
  }

  async function loadContacts(userId: string) {
    const client = getSupabaseClient()
    if (!client) return

    try {
      // Load accepted contacts
      const { data, error } = await client
        .from('contacts')
        .select('*, contact_profile:profiles(*)')
        .eq('user_id', userId)
        .eq('status', 'accepted')

      if (!error && data) {
        setContacts(data as Contact[])
      }

      // Load pending requests I RECEIVED (others wanting to add me)
      const { data: pendingData, error: pendingError } = await client
        .from('contacts')
        .select('*, contact_profile:profiles(*)')
        .eq('contact_id', userId)
        .eq('status', 'pending')

      if (!pendingError && pendingData) {
        setPendingContacts(pendingData as Contact[])
      }

      // Subscribe to new contact requests (where I am the recipient)
      const contactsSub = client
        .channel('contacts-watcher')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'contacts' },
          async (payload) => {
            const newContact = payload.new as { contact_id: string; status: string; user_id: string }
            if (newContact.contact_id === userId && newContact.status === 'pending') {
              // Someone sent me a contact request
              const state = useAppStore.getState()

              // Fetch the sender's profile
              const { data: senderProfile } = await client
                .from('profiles')
                .select('*')
                .eq('id', newContact.user_id)
                .single()

              if (senderProfile) {
                // Get the full contact row
                const { data: fullContact } = await client
                  .from('contacts')
                  .select('*, contact_profile:profiles(*)')
                  .eq('user_id', newContact.user_id)
                  .eq('contact_id', userId)
                  .single()

                if (fullContact) {
                  state.addPendingContact(fullContact as Contact)
                  showToast(`${senderProfile.display_name} sent you a contact request`)
                }
              }
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'contacts' },
          (payload) => {
            const updated = payload.new as { contact_id: string; status: string; user_id: string }
            // If someone I sent a request to accepted it
            if (updated.user_id === userId && updated.status === 'accepted') {
              // Reload contacts to reflect the change
              loadContacts(userId)
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'contacts' },
          (payload) => {
            const deleted = payload.old as { contact_id: string; user_id: string }
            // If someone I sent a request to rejected it (deleted the row)
            if (deleted.user_id === userId) {
              const state = useAppStore.getState()
              state.removePendingContact(deleted.user_id)
            }
          }
        )
        .subscribe()

      // Store subscription for cleanup
      return () => {
        contactsSub.unsubscribe()
      }
    } catch {
      // contacts table missing
    }
  }

  async function loadChannels(workspaceId: string) {
    const client = getSupabaseClient()
    if (!client) return

    const userId = useAppStore.getState().user?.id
    if (!userId) return

    const { data: myMemberships } = await client
      .from('channel_members')
      .select('channel_id')
      .eq('profile_id', userId)

    if (!myMemberships || myMemberships.length === 0) return

    const myChannelIds = myMemberships.map((m) => m.channel_id)

    const { data: myChannels } = await client
      .from('channels')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_archived', false)
      .in('id', myChannelIds)
      .order('name')

    const allChannels = ((myChannels || []) as Channel[]).filter(
      (c) => !c.name.startsWith('dm-') && !c.name.startsWith('gdm-')
    )

    if (allChannels.length > 0) {
      setChannels(allChannels)
      const general = allChannels.find((c: Channel) => c.name === 'general') || allChannels[0]
      setCurrentChannelId(general.id)
    }
  }

  async function handleWorkspaceCreated(ws: Workspace) {
    setWorkspace(ws)
    setShowWorkspaceSetup(false)
    await loadChannels(ws.id)
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="max-w-md w-full space-y-4 text-center p-6">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              onClick={() => {
                setError(null)
                setLoading(true)
                loadUserData()
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const client = getSupabaseClient()
                client?.auth.signOut()
                router.push('/auth')
              }}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (showWorkspaceSetup) {
    return <WorkspaceSetup onCreated={handleWorkspaceCreated} />
  }

  if (!workspace && !personalWorkspace) {
    return null
  }

  return (
    <div className="h-screen flex bg-background relative overflow-hidden">
      <IncomingCallBanner />

      {isDesktop ? (
        <Sidebar />
      ) : (
        <>
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/30 z-40 transition-opacity"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div className={`fixed left-0 top-0 h-full z-50 transition-transform duration-200 ease-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </>
      )}

      <ActivityPanel />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
      <CallPanel />
      <ContactRequestToast />
    </div>
  )
}
