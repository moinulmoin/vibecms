/** Counts D1 calls, including each batch as one query, before dispatch. */
export class D1QueryBudget {
  used = 0
  constructor(readonly limit: number, private readonly exhaustedMessage = 'd1_query_budget_exhausted') {}
  remaining(): number { return this.limit - this.used }
  covers(queries: number): boolean { return this.remaining() >= queries }
  spend(): void {
    if (!this.covers(1)) throw new Error(this.exhaustedMessage)
    this.used += 1
  }
}

/** Wrap once per job; unwrap batch statements so their executions are not counted twice. */
export function budgetedD1(db: D1Database, budget: D1QueryBudget): D1Database {
  const unwrapped = new WeakMap<object, D1PreparedStatement>()
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const counted = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...values: unknown[]) => wrapStatement(target.bind(...values))
        if (property === 'first' || property === 'run' || property === 'all' || property === 'raw') {
          const method = Reflect.get(target, property, target) as (...args: unknown[]) => unknown
          return (...args: unknown[]) => {
            budget.spend()
            return method.apply(target, args)
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    unwrapped.set(counted, statement)
    return counted
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (query: string) => wrapStatement(target.prepare(query))
      if (property === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          budget.spend()
          return target.batch(statements.map((statement) => unwrapped.get(statement) ?? statement))
        }
      }
      if (property === 'exec') {
        return (query: string) => {
          budget.spend()
          return target.exec(query)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
