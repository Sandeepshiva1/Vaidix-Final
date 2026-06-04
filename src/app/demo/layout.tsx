import type { ReactNode } from 'react'
import { DemoStateProvider } from '@/components/demo/demo-state'
import { DemoShell } from '@/components/demo/demo-shell'

export const metadata = {
  title: 'Vaidix — Demo Prototype',
}

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoStateProvider>
      <DemoShell>{children}</DemoShell>
    </DemoStateProvider>
  )
}
