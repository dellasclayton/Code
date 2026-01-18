import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import Sidebar from '@/components/layout/Sidebar'
import { cn } from '@/lib/utils'

function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="dark min-h-screen bg-[#191b1f] text-[#e2e6ea]">
      <div className="flex h-screen gap-3 p-3">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            className={cn(
              'flex min-h-0 flex-1 rounded-2xl border border-[#333] bg-[#191b1f] p-8',
              'shadow-[0_20px_60px_rgba(0,0,0,0.35)]'
            )}
          >
            <div
              className={cn(
                'relative h-full w-full rounded-2xl border border-[#242830] bg-[#1c1e22]',
                'bg-[radial-gradient(1200px_circle_at_top,_#22262c_0%,_#1c1e22_40%,_#191b1f_100%)]'
              )}
            >
            <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default AppLayout
