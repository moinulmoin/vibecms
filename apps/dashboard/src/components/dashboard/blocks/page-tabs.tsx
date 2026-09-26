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
    // On narrow screens the row scrolls sideways; the fade on the trailing edge
    // says there is more than fits.
    <div className="-mx-1 overflow-x-auto border-b border-[color:var(--hairline)] px-1 pb-[5px] [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [&::-webkit-scrollbar]:hidden">
      <TabsList aria-label={label} variant="line" className="h-10 min-w-max gap-4 p-0 pr-6 sm:gap-5 sm:pr-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="h-10 flex-none px-0 text-sm font-normal data-[state=active]:font-medium sm:text-[0.9375rem]"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  )
}
