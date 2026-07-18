'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, Loader2, Users, Briefcase } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { Workspace, Channel } from '@/types/database'
import { cn } from '@/lib/utils'

interface WorkspaceSetupProps {
  onCreated: (workspace: Workspace) => void
}

export function WorkspaceSetup({ onCreated }: WorkspaceSetupProps) {
  const [name, setName] = useState('')
  const [workspaceType, setWorkspaceType] = useState<'personal' | 'business'>('business')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const client = getSupabaseClient()
    if (!client || !name.trim()) return

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await client.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const slug = name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')

      const workspaceId = crypto.randomUUID()

      const { error: wsError } = await client
        .from('workspaces')
        .insert({
          id: workspaceId,
          name: name.trim(),
          slug,
          workspace_type: workspaceType,
        })

      if (wsError) throw wsError

      const { error: memberError } = await client.from('workspace_members').insert({
        workspace_id: workspaceId,
        profile_id: session.user.id,
        role: 'owner',
      })

      if (memberError) throw memberError

      const { data: workspace, error: fetchError } = await client
        .from('workspaces')
        .select()
        .eq('id', workspaceId)
        .single()

      if (fetchError) throw fetchError

      // Create #general channel for business workspaces
      if (workspaceType === 'business') {
        const { data: general } = await client
          .from('channels')
          .insert({
            workspace_id: workspace.id,
            name: 'general',
            description: 'General discussion',
            created_by: session.user.id,
          })
          .select()
          .single()

        if (general) {
          await client.from('channel_members').insert({
            channel_id: general.id,
            profile_id: session.user.id,
            role: 'admin',
          })
        }

        const { data: random } = await client
          .from('channels')
          .insert({
            workspace_id: workspace.id,
            name: 'random',
            description: 'Random stuff and off-topic',
            created_by: session.user.id,
          })
          .select()
          .single()

        if (random) {
          await client.from('channel_members').insert({
            channel_id: random.id,
            profile_id: session.user.id,
          })
        }
      }

      onCreated(workspace as Workspace)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <Building2 className="mx-auto h-12 w-12 text-primary mb-2" />
          <CardTitle>Create your workspace</CardTitle>
          <CardDescription>This is where your team will communicate.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Workspace type selection */}
            <div className="space-y-2">
              <Label>Workspace Type</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setWorkspaceType('business')}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                    workspaceType === 'business'
                      ? 'border-[#DC2626] bg-[#FEF2F2]'
                      : 'border-[#E7E5E4] hover:border-[#FECACA]'
                  )}
                >
                  <Briefcase
                    className="h-6 w-6"
                    style={{ color: workspaceType === 'business' ? '#DC2626' : '#A8A29E' }}
                  />
                  <span className="text-sm font-medium" style={{ color: workspaceType === 'business' ? '#DC2626' : '#78716C' }}>
                    Business
                  </span>
                  <span className="text-[11px] text-center" style={{ color: '#A8A29E' }}>
                    For teams &amp; projects
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceType('personal')}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                    workspaceType === 'personal'
                      ? 'border-[#DC2626] bg-[#FEF2F2]'
                      : 'border-[#E7E5E4] hover:border-[#FECACA]'
                  )}
                >
                  <Users
                    className="h-6 w-6"
                    style={{ color: workspaceType === 'personal' ? '#DC2626' : '#A8A29E' }}
                  />
                  <span className="text-sm font-medium" style={{ color: workspaceType === 'personal' ? '#DC2626' : '#78716C' }}>
                    Personal
                  </span>
                  <span className="text-[11px] text-center" style={{ color: '#A8A29E' }}>
                    For contacts &amp; DMs
                  </span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace Name</Label>
              <Input
                id="workspace-name"
                placeholder={workspaceType === 'personal' ? 'My Personal Space' : 'My Team'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
