import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vc/ui";

export function TokenCreated({ token, name }: { token: string; name: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <Button asChild variant="link" className="w-fit px-0"><a href="/app/settings">← Settings</a></Button>
          <CardTitle className="text-4xl font-black tracking-[-0.06em]">Token created</CardTitle>
          <CardDescription>Copy this token now. It will not be shown again.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <pre className="overflow-auto rounded-lg border bg-muted p-4 text-sm">{token}</pre>
          <p className="text-sm text-muted-foreground">{name}</p>
        </CardContent>
      </Card>
    </main>
  );
}
