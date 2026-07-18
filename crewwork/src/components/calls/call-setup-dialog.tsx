'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Phone } from 'lucide-react'

interface CallSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CallSetupDialog({ open, onOpenChange }: CallSetupDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: '#FEE2E2' }}>
              <Phone className="h-5 w-5" style={{ color: '#DC2626' }} />
            </div>
            <AlertDialogTitle>Calls not enabled</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left">
            Video and audio calls are powered by LiveKit. An admin needs to enable calls in <strong>Workspace Settings &rarr; Calls</strong>.
            <br /><br />
            Server credentials (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL) must be configured in the server environment.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction style={{ background: '#DC2626' }}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
