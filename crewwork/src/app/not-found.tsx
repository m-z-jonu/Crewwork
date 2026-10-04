import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4 text-center">
      <p className="text-8xl font-bold tracking-tight text-primary">404</p>
      <p className="text-lg text-muted-foreground">
        This page could not be found.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go home
        </Link>
        <Link
          href="/auth"
          className="inline-flex h-10 items-center rounded-md border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Open app
        </Link>
      </div>
    </div>
  )
}
