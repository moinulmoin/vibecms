import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { BRAND } from '@vc/config'
import { DEFAULT_SCOPES, type PostStatus } from '@vc/core'
import type { AuthUser } from '@vc/db'
import { mcpToolNames } from '@vc/mcp'
import { Button } from '@vc/ui'

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
    <main className="min-h-dvh bg-background p-6 text-foreground">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">{data.brandName}</h1>
        <p className="font-sans text-sm text-muted-foreground">{data.tagline}</p>
        <dl className="space-y-1 font-mono text-sm">
          <div>
            <dt className="inline text-muted-foreground">postStatus </dt>
            <dd className="inline text-foreground">{data.postStatus}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">scopeCount </dt>
            <dd className="inline text-foreground">{data.scopeCount}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">authUserField </dt>
            <dd className="inline text-foreground">{data.authUserField}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">mcpToolCount </dt>
            <dd className="inline text-foreground">{data.mcpToolCount}</dd>
          </div>
        </dl>
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  )
}