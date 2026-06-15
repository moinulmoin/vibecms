import { setupAuthClient } from '~/lib/auth-client'
import { Button } from '@vc/ui'
import { useTransition } from 'react'

export function LogoutButton({ authUrl }: { authUrl: string }) {
  const [isPending, startTransition] = useTransition()
  const authClient = setupAuthClient(authUrl)
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto self-start px-2 py-1 text-muted-foreground hover:text-foreground"
      disabled={isPending}
      onClick={() =>
        startTransition(() => {
          void authClient.signOut({
            fetchOptions: {
              onSuccess: () => {
                window.location.href = '/login'
              },
            },
          })
        })
      }
    >
      {isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}