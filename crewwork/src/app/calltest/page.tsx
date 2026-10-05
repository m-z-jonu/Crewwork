import { notFound } from 'next/navigation'
import { CallTestHarness } from './harness'

export default function CallTestPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <CallTestHarness />
}
