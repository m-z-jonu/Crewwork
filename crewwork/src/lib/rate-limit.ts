const rateLimit = new Map<string, { count: number; resetTime: number }>()

export function checkRateLimit(key: string, limit: number = 10, windowMs: number = 60000): boolean {
  const now = Date.now()
  const entry = rateLimit.get(key)

  if (!entry || now > entry.resetTime) {
    rateLimit.set(key, { count: 1, resetTime: now + windowMs })
    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count++
  return true
}
