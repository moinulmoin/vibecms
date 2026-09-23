import type { ReactNode } from 'react'
import { TabsList, TabsTrigger } from '~/components/ui/tabs'

/** Horizontal, underlined page tabs. Drive the value from a URL search param. */
export function PageTabs({
  tabs,
  label,
}: {
  tabs: Array<{ value: string; label: ReactNode }>
  label: string
}) {
  return (
    <div className="-mx-1 overflow-x-auto border-b border-[color:var(--hairline)] px-1 pb-[5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TabsList aria-label={label} variant="line" className="h-10 min-w-max gap-5 p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="h-10 flex-none px-0 text-[0.9375rem] font-normal data-[state=active]:font-medium"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}
