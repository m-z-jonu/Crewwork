export function log(message: string, ...args: unknown[]) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(message, ...args)
  }
}

export function logError(message: string, ...args: unknown[]) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(message, ...args)
  }
}
