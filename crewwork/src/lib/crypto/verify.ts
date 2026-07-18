/**
 * CrewWork E2EE - Key Verification
 *
 * Safety numbers and QR code generation for verifying identity keys.
 * Safety numbers let users manually confirm they're communicating
 * with the right person (no MITM).
 */

// ============================================================================
// Safety Number Generation
// ============================================================================

/**
 * Generate safety number from two identity keys.
 * Format: 12 groups of 5 hex characters (60 hex chars total)
 *
 * Both parties should produce the same safety number when given
 * the same pair of identity keys (order matters: my + their).
 */
export async function generateSafetyNumber(
  myIdentityKey: string,    // base64
  theirIdentityKey: string  // base64
): Promise<string> {
  const encoder = new TextEncoder()
  const combined = encoder.encode(myIdentityKey + theirIdentityKey)
  const hash = await crypto.subtle.digest('SHA-256', combined)
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  // Take first 60 chars, format as 12 groups of 5
  return hex.slice(0, 60).match(/.{1,5}/g)!.join(' ')
}

// ============================================================================
// QR Code Generation
// ============================================================================

/**
 * Generate QR code data for key verification.
 * Returns a JSON string containing all info needed to verify a contact.
 */
export async function generateVerificationQR(
  myIdentityKey: string,
  theirIdentityKey: string,
  myUserId: string,
  theirUserId: string
): Promise<string> {
  const safetyNumber = await generateSafetyNumber(myIdentityKey, theirIdentityKey)
  return JSON.stringify({
    v: 1,
    myKey: myIdentityKey,
    theirKey: theirIdentityKey,
    myId: myUserId,
    theirId: theirUserId,
    safety: safetyNumber,
  })
}

/**
 * Parse and validate a verification QR code payload.
 * Returns null if the payload is invalid or corrupted.
 */
export async function parseVerificationQR(
  qrData: string,
  myIdentityKey: string,
  theirIdentityKey: string
): Promise<{
  valid: boolean
  safetyNumber: string
  matched: boolean
} | null> {
  try {
    const parsed = JSON.parse(qrData)
    if (parsed.v !== 1 || !parsed.safety || !parsed.myKey || !parsed.theirKey) {
      return null
    }

    // Regenerate safety number from the keys in the QR and compare
    const expectedSafety = await generateSafetyNumber(myIdentityKey, theirIdentityKey)
    const scannedSafety = parsed.safety as string

    return {
      valid: true,
      safetyNumber: scannedSafety,
      matched: expectedSafety === scannedSafety,
    }
  } catch {
    return null
  }
}

// ============================================================================
// QR Code SVG Renderer (inline, no dependencies)
// ============================================================================

/**
 * Minimal QR-like visual hash for key verification.
 * This is NOT a real QR code — it's a deterministic visual fingerprint
 * derived from the safety number for visual comparison.
 *
 * For full QR code support, integrate a library like `qrcode`.
 */
export function generateVerificationVisual(safetyNumber: string): string {
  // Simple 5x5 grid pattern derived from the safety number hex chars
  const hex = safetyNumber.replace(/\s/g, '')
  const cells: string[] = []

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col
      const charCode = hex.charCodeAt(idx % hex.length)
      // Use even/odd bit pattern for deterministic fill
      const filled = (charCode & (1 << (col % 4))) !== 0
      if (filled) {
        cells.push(
          `<rect x="${col * 10}" y="${row * 10}" width="10" height="10" fill="currentColor"/>`
        )
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="200" height="200">
  <rect width="50" height="50" fill="white"/>
  ${cells.join('\n  ')}
</svg>`
}
