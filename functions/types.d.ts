declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

declare interface PagesFunctionContext<Env = Record<string, unknown>> {
  request: Request;
  env: Env;
  executionCtx: ExecutionContext;
  next(): Promise<Response>;
}

declare type PagesFunction<Env = Record<string, unknown>> = (
  context: PagesFunctionContext<Env>,
) => Response | Promise<Response>;
