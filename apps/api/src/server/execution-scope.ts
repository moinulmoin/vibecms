import { AsyncLocalStorage } from 'node:async_hooks'

const executionScope = new AsyncLocalStorage<ExecutionContext>()

export function runWithExecutionContext<T>(ctx: ExecutionContext, fn: () => T): T {
  return executionScope.run(ctx, fn)
}

export function scheduleBackground(task: Promise<unknown>): void {
  const executionContext = executionScope.getStore()
  if (executionContext) {
    executionContext.waitUntil(task)
    return
  }
  void task
}