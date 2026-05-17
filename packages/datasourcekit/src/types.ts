// datasourcekit's own context — no dashboard concepts
export interface DatasourceContext {
  timeRange?: { from: string; to: string; raw?: { from: string; to: string } }
  variables?: Record<string, string | string[]>
  authContext?: unknown
  signal?: AbortSignal
}

// Incoming request — uid + query descriptor, no panel/dashboard info
export interface DatasourceRequest<TQuery = unknown> {
  uid: string
  type?: string
  query?: TQuery
  options?: Record<string, unknown>
}

// Simple tabular result — datasourcekit stays out of the frame format business
export interface DatasourceResult {
  columns: Array<{ name: string; type?: string; meta?: Record<string, unknown> }>
  rows: unknown[][]
  meta?: Record<string, unknown>
}

// Plugin definition
export interface DatasourcePlugin<TOptions = Record<string, unknown>, TQuery = unknown> {
  uid: string
  type: string
  options?: TOptions
  cacheTtlMs?: number
  queryData(
    request: DatasourceRequest<TQuery>,
    context: DatasourceContext,
  ): Promise<DatasourceResult>
  subscribeData?(
    request: DatasourceRequest<TQuery>,
    context: DatasourceContext,
    onData: (result: DatasourceResult) => void,
    onError: (error: Error) => void,
  ): () => void
}

// Executor interface
export interface DatasourceExecutor {
  query(request: DatasourceRequest, context?: DatasourceContext): Promise<DatasourceResult>
  subscribe(
    request: DatasourceRequest,
    context: DatasourceContext,
    onData: (result: DatasourceResult) => void,
    onError: (error: Error) => void,
  ): (() => void) | null
}
