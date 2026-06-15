import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { BRAND } from '@vc/config'
import { DEFAULT_SCOPES, type PostStatus } from '@vc/core'
import type { AuthUser } from '@vc/db'
import { mcpToolNames } from '@vc/mcp'

const getFoundationSmoke = createServerFn({ method: 'GET' }).handler(() => {
  const postStatus: PostStatus = 'draft'
  const scopeCount = DEFAULT_SCOPES.length
  const authUserField: keyof Pick<AuthUser, 'id' | 'email'> = 'email'
  return {
    brandName: BRAND.name,
    tagline: BRAND.tagline,
    postStatus,
    scopeCount,
    authUserField,
    mcpToolCount: mcpToolNames.length,
  }
})

export const Route = createFileRoute('/')({
  loader: () => getFoundationSmoke(),
  component: Home,
})

function Home() {
  const data = Route.useLoaderData()

  return (
    <main className="p-6 max-w-xl space-y-3">
      <h1 className="text-2xl font-bold">{data.brandName}</h1>
      <p className="text-gray-600 dark:text-gray-400">{data.tagline}</p>
      <dl className="text-sm space-y-1 font-mono">
        <div>
          <dt className="inline text-gray-500">postStatus </dt>
          <dd className="inline">{data.postStatus}</dd>
        </div>
        <div>
          <dt className="inline text-gray-500">scopeCount </dt>
          <dd className="inline">{data.scopeCount}</dd>
        </div>
        <div>
          <dt className="inline text-gray-500">authUserField </dt>
          <dd className="inline">{data.authUserField}</dd>
        </div>
        <div>
          <dt className="inline text-gray-500">mcpToolCount </dt>
          <dd className="inline">{data.mcpToolCount}</dd>
        </div>
      </dl>
    </main>
  )
}