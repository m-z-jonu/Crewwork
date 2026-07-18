'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAppStore } from '@/lib/store/app-store'
import { Loader2 } from 'lucide-react'

interface WorkspacePersonalSettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspacePersonalSettings({ open, onOpenChange }: WorkspacePersonalSettingsProps) {
  const { personalWorkspace, setPersonalWorkspace } = useAppStore()
  const [name, setName] = useState(personalWorkspace?.personal_name || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const client = getSupabaseClient()
    if (!client || !personalWorkspace) return

    setLoading(true)
    setError(null)

    try {
      const trimmedName = name.trim()
      const { error: updateError } = await client
        .from('workspaces')
        .update({ personal_name: trimmedName || null })
        .eq('id', personalWorkspace.id)

      if (updateError) throw updateError

      setPersonalWorkspace({
        ...personalWorkspace,
        personal_name: trimmedName || null,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Personal Space Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="personal-name">Space Name</Label>
            <Input
              id="personal-name"
              placeholder="My Personal Space"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-[12px]" style={{ color: '#A8A29E' }}>
              This is your private space for contacts, DMs, and groups.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-md" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              <p className="text-sm">{error}</p>
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={loading}
            className="w-full"
            style={{ background: '#DC2626', color: '#fff' }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
