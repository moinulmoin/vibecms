import { handleSubscribe } from '@/server/subscribe'

export type SubscribeRpcInput = { request: Request }

export async function rpcHandleSubscribe(input: SubscribeRpcInput): Promise<Response> {
  const result = await handleSubscribe(input.request)
  return Response.json(result.body, { status: result.status })
}