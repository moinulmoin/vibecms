import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { onDashboardMutation } from '~/lib/api-client'
import { markDashboardDataStale, queryClient } from '~/lib/queries'
import { getRouter } from './router'
import './styles.css'

const router = getRouter()
onDashboardMutation(() => markDashboardDataStale(queryClient))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
