import type {
  Annotation,
  AnnotationQuery,
  DashboardDatasourceAdapter,
  DashboardDatasourceContext,
  DataRequestConfig,
  DatasourceHealthResult,
  DatasourceSchemaField,
  DatasourceSchemaFieldRequest,
  DatasourceSchemaNamespace,
  DatasourceValidationResult,
  QueryResult,
  VariableOption,
} from '@loykin/dashboardkit'

export type DataQuery<TQuery = unknown> = {
  id: string
  datasourceUid: string
  datasourceType?: string
  query?: TQuery
  options?: Record<string, unknown>
}

export type DashboardDatasourceQueryContext<TOptions = Record<string, unknown>> =
  Omit<DashboardDatasourceContext, 'dashboardId' | 'panelId' | 'requestId' | 'variables'> & {
    dashboardId: string
    panelId: string
    requestId: string
    variables: Record<string, string | string[]>
    datasourceOptions: TOptions
    query?: unknown
    dataRequest?: DataRequestConfig
  }

export interface TestDatasourceDef<TOptions = Record<string, unknown>, TQuery = unknown> {
  uid: string
  type: string
  options?: TOptions
  cacheTtlMs?: number
  queryData?: (
    request: DataQuery<TQuery>,
    context: DashboardDatasourceQueryContext<TOptions>,
  ) => Promise<QueryResult>
  subscribeData?: (
    request: DataQuery<TQuery>,
    context: DashboardDatasourceQueryContext<TOptions>,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ) => () => void
  variable?: {
    metricFindQuery?(
      query: string,
      context: DashboardDatasourceQueryContext<TOptions>,
    ): Promise<VariableOption[]>
  }
  annotations?: {
    queryAnnotations?(
      query: AnnotationQuery,
      context: DashboardDatasourceQueryContext<TOptions>,
    ): Promise<Annotation[]>
  }
  schema?: {
    listNamespaces?(
      context: DashboardDatasourceQueryContext<TOptions>,
    ): Promise<DatasourceSchemaNamespace[]>
    listFields?(
      request: DatasourceSchemaFieldRequest,
      context: DashboardDatasourceQueryContext<TOptions>,
    ): Promise<DatasourceSchemaField[]>
  }
  connector?: {
    configSchema?: Record<string, unknown>
    healthCheck?(
      options: TOptions,
      context: Pick<DashboardDatasourceContext, 'authContext'>,
    ): Promise<DatasourceHealthResult>
  }
  editor?: {
    validateQuery?(
      query: unknown,
      context: DashboardDatasourceQueryContext<TOptions>,
    ): DatasourceValidationResult | Promise<DatasourceValidationResult>
  }
}

export type TestDatasourceAdapter<TOptions = Record<string, unknown>, TQuery = unknown> =
  DashboardDatasourceAdapter & TestDatasourceDef<TOptions, TQuery>

function dataQuery(request: DataRequestConfig): DataQuery {
  return {
    id: request.id,
    datasourceUid: request.uid,
    datasourceType: request.type,
    ...(request.query !== undefined ? { query: request.query } : {}),
    options: request.options,
  }
}

function contextFor<TOptions, TQuery>(
  datasource: TestDatasourceDef<TOptions, TQuery>,
  request: DataRequestConfig,
  context: DashboardDatasourceContext,
): DashboardDatasourceQueryContext<TOptions> {
  return {
    ...context,
    dashboardId: context.dashboardId ?? '',
    panelId: context.panelId ?? '',
    requestId: context.requestId ?? request.id,
    variables: context.variables,
    datasourceOptions: datasource.options ?? ({} as TOptions),
    ...(request.query !== undefined ? { query: request.query } : {}),
    dataRequest: request,
  }
}

export function defineDatasource<TOptions = Record<string, unknown>, TQuery = unknown>(
  def: TestDatasourceDef<TOptions, TQuery>,
): TestDatasourceAdapter<TOptions, TQuery> {
  const adapter: TestDatasourceAdapter<TOptions, TQuery> = {
    ...def,
    validateRequest(request) {
      if (request.uid !== def.uid) throw new Error(`datasource "${request.uid}" not registered in engine`)
      if (request.type !== def.type) {
        throw new Error(`datasource "${request.uid}" type mismatch: expected "${request.type}", got "${def.type}"`)
      }
    },
    async query(request, context) {
      adapter.validateRequest?.(request, context)
      if (!def.queryData) throw new Error(`datasource "${request.uid}" does not support query`)
      return def.queryData(dataQuery(request) as DataQuery<TQuery>, contextFor<TOptions, TQuery>(def, request, context))
    },
    subscribe(request, context, onData, onError) {
      adapter.validateRequest?.(request, context)
      if (!def.subscribeData) return null
      return def.subscribeData(dataQuery(request) as DataQuery<TQuery>, contextFor<TOptions, TQuery>(def, request, context), onData, onError)
    },
    async metricFindQuery(request, context) {
      adapter.validateRequest?.(request, context)
      if (!def.variable?.metricFindQuery || typeof request.query !== 'string') return []
      return def.variable.metricFindQuery(request.query, contextFor<TOptions, TQuery>(def, request, context))
    },
    async queryAnnotations(query, context) {
      const request = {
        id: query.id,
        uid: query.datasourceUid,
        type: def.type,
        query: query.query,
        options: {},
        hide: false,
        permissions: [],
        staleWhileRevalidate: false,
      }
      adapter.validateRequest?.(request, context)
      return def.annotations?.queryAnnotations?.(contextFor<TOptions, TQuery>(def, request, context)) ?? []
    },
    async listNamespaces(_datasourceUid, context) {
      const request = { id: 'schema', uid: def.uid, type: def.type, options: {}, hide: false, permissions: [], staleWhileRevalidate: false }
      return def.schema?.listNamespaces?.(contextFor<TOptions, TQuery>(def, request, context)) ?? []
    },
    async listFields(_datasourceUid, request, context) {
      const dataRequest = { id: 'schema', uid: def.uid, type: def.type, options: {}, hide: false, permissions: [], staleWhileRevalidate: false }
      return def.schema?.listFields?.(request, contextFor<TOptions, TQuery>(def, dataRequest, context)) ?? []
    },
    async healthCheck(_datasourceUid, context) {
      return def.connector?.healthCheck?.(def.options ?? ({} as TOptions), context) ?? { ok: false, message: 'healthCheck not supported' }
    },
    async validateQuery(_datasourceUid, query, context) {
      const request = { id: 'validation', uid: def.uid, type: def.type, options: {}, hide: false, permissions: [], staleWhileRevalidate: false }
      return def.editor?.validateQuery?.(query, contextFor<TOptions, TQuery>(def, request, context)) ?? { valid: true }
    },
    getCacheTtlMs() {
      return def.cacheTtlMs
    },
  }
  return adapter
}

export function createDatasourceAdapter(
  datasources: readonly TestDatasourceAdapter[],
): DashboardDatasourceAdapter {
  const byUid = new Map(datasources.map((datasource) => [datasource.uid, datasource]))
  const get = (uid: string) => byUid.get(uid)

  return {
    validateRequest(request, context) {
      const datasource = get(request.uid)
      if (!datasource) throw new Error(`datasource "${request.uid}" not registered in engine`)
      datasource.validateRequest?.(request, context)
    },
    query(request, context) {
      const datasource = get(request.uid)
      if (!datasource) return Promise.reject(new Error(`datasource "${request.uid}" not registered in engine`))
      return datasource.query(request, context)
    },
    subscribe(request, context, onData, onError) {
      return get(request.uid)?.subscribe?.(request, context, onData, onError) ?? null
    },
    metricFindQuery(request, context) {
      return get(request.uid)?.metricFindQuery?.(request, context) ?? Promise.resolve([])
    },
    queryAnnotations(query, context) {
      return get(query.datasourceUid)?.queryAnnotations?.(context) ?? Promise.resolve([])
    },
    listNamespaces(datasourceUid, context) {
      return get(datasourceUid)?.listNamespaces?.(datasourceUid, context) ?? Promise.resolve([])
    },
    listFields(datasourceUid, request, context) {
      return get(datasourceUid)?.listFields?.(datasourceUid, request, context) ?? Promise.resolve([])
    },
    healthCheck(datasourceUid, context) {
      return get(datasourceUid)?.healthCheck?.(datasourceUid, context) ?? Promise.resolve({ ok: false, message: 'healthCheck not supported' })
    },
    validateQuery(datasourceUid, query, context) {
      return get(datasourceUid)?.validateQuery?.(datasourceUid, query, context) ?? Promise.resolve({ valid: true })
    },
    getCacheTtlMs(request, context) {
      return get(request.uid)?.getCacheTtlMs?.(request, context)
    },
  }
}
