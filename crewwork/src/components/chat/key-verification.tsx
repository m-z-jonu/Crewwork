"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import DOMPurify from "dompurify"
import {
  generateSafetyNumber,
  generateVerificationQR,
  generateVerificationVisual,
} from "@/lib/crypto/verify"

interface KeyVerificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  myIdentityKey: string
  theirIdentityKey: string
  myUserId: string
  theirUserId: string
  theirName?: string
  onVerified?: () => void
}

export function KeyVerificationDialog({
  open,
  onOpenChange,
  myIdentityKey,
  theirIdentityKey,
  myUserId,
  theirUserId,
  theirName = "contact",
  onVerified,
}: KeyVerificationDialogProps) {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null)
  const [qrData, setQrData] = useState<string | null>(null)
  const [visual, setVisual] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return

    setLoading(true)
    Promise.all([
      generateSafetyNumber(myIdentityKey, theirIdentityKey),
      generateVerificationQR(myIdentityKey, theirIdentityKey, myUserId, theirUserId),
    ]).then(([safety, qr]) => {
      setSafetyNumber(safety)
      setQrData(qr)
      setVisual(generateVerificationVisual(safety))
      setLoading(false)
    })
  }, [open, myIdentityKey, theirIdentityKey, myUserId, theirUserId])

  const safetyGroups = useMemo(() => {
    if (!safetyNumber) return []
    return safetyNumber.split(" ")
  }, [safetyNumber])

  const handleCopy = async () => {
    if (!safetyNumber) return
    await navigator.clipboard.writeText(safetyNumber)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleVerify = () => {
    onVerified?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify {theirName}</DialogTitle>
          <DialogDescription>
            Compare the safety number below with {theirName}. If they match on both sides,
            your connection is secure.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Visual fingerprint */}
            {visual && (
              <div className="flex justify-center">
                <div
                  className="rounded-lg border bg-white p-4 text-black"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(visual, { USE_PROFILES: { svg: true } }) }}
                />
              </div>
            )}

            {/* Safety number display */}
            {safetyNumber && (
              <div className="space-y-2">
                <p className="text-center text-xs font-medium text-muted-foreground">
                  Safety Number
                </p>
                <div className="grid grid-cols-4 gap-1 rounded-lg border bg-muted/50 p-3">
                  {safetyGroups.map((group, i) => (
                    <span
                      key={i}
                      className="font-mono text-sm font-medium text-center"
                    >
                      {group}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Copy button */}
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy Safety Number"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleVerify} disabled={loading}>
            Verify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
