import { tableRowsToQueryResult } from '@loykin/dashboardkit'
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
  TableRowsInput,
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
  name?: string
  options?: TOptions
  cacheTtlMs?: number
  queryData?: (
    request: DataQuery<TQuery>,
    context: DashboardDatasourceQueryContext<TOptions>,
  ) => Promise<QueryResult | TableRowsInput>
  subscribeData?: (
    request: DataQuery<TQuery>,
    context: DashboardDatasourceQueryContext<TOptions>,
    onData: (result: QueryResult | TableRowsInput) => void,
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

function normalize(result: QueryResult | TableRowsInput): QueryResult {
  return 'frames' in result ? result : tableRowsToQueryResult(result)
}

function toDataQuery<TQuery>(request: DataRequestConfig): DataQuery<TQuery> {
  return {
    id: request.id,
    datasourceUid: request.uid,
    datasourceType: request.type,
    ...(request.query !== undefined ? { query: request.query as TQuery } : {}),
    options: request.options,
  }
}

function toQueryContext<TOptions>(
  datasourceOptions: TOptions,
  request: DataRequestConfig,
  context: DashboardDatasourceContext,
): DashboardDatasourceQueryContext<TOptions> {
  return {
    ...context,
    dashboardId: context.dashboardId ?? '',
    panelId: context.panelId ?? '',
    requestId: context.requestId ?? request.id,
    variables: context.variables,
    datasourceOptions,
    ...(request.query !== undefined ? { query: request.query } : {}),
    dataRequest: request,
  }
}

function syntheticRequest(
  def: { uid: string; type: string },
  id: string,
  query?: DataRequestConfig['query'],
): DataRequestConfig {
  return {
    id,
    uid: def.uid,
    type: def.type,
    ...(query !== undefined ? { query } : {}),
    options: {},
    hide: false,
    permissions: [],
    staleWhileRevalidate: false,
  }
}

export function defineDatasource<TOptions = Record<string, unknown>, TQuery = unknown>(
  def: TestDatasourceDef<TOptions, TQuery>,
): TestDatasourceAdapter<TOptions, TQuery> {
  const adapter: TestDatasourceAdapter<TOptions, TQuery> = {
    ...def,
    validateRequest(request) {
      if (request.uid !== def.uid)
        throw new Error(`datasource "${request.uid}" not registered`)
      if (request.type !== def.type)
        throw new Error(`datasource "${request.uid}" type mismatch: expected "${request.type}", got "${def.type}"`)
    },
    async query(request, context) {
      adapter.validateRequest?.(request, context)
      if (!def.queryData) throw new Error(`datasource "${def.uid}" does not support query`)
      return normalize(
        await def.queryData(toDataQuery<TQuery>(request), toQueryContext(def.options ?? ({} as TOptions), request, context)),
      )
    },
    subscribe(request, context, onData, onError) {
      adapter.validateRequest?.(request, context)
      if (!def.subscribeData) return null
      return def.subscribeData(
        toDataQuery<TQuery>(request),
        toQueryContext(def.options ?? ({} as TOptions), request, context),
        (result) => onData(normalize(result)),
        onError,
      )
    },
    async metricFindQuery(request, context) {
      adapter.validateRequest?.(request, context)
      if (!def.variable?.metricFindQuery || typeof request.query !== 'string') return []
      return def.variable.metricFindQuery(request.query, toQueryContext(def.options ?? ({} as TOptions), request, context))
    },
    async queryAnnotations(query, context) {
      const request = syntheticRequest(def, query.id, query.query)
      request.uid = query.datasourceUid
      adapter.validateRequest?.(request, context)
      return def.annotations?.queryAnnotations?.(query, toQueryContext(def.options ?? ({} as TOptions), request, context)) ?? []
    },
    async listNamespaces(_uid, context) {
      return def.schema?.listNamespaces?.(
        toQueryContext(def.options ?? ({} as TOptions), syntheticRequest(def, 'schema'), context),
      ) ?? []
    },
    async listFields(_uid, fieldRequest, context) {
      return def.schema?.listFields?.(
        fieldRequest,
        toQueryContext(def.options ?? ({} as TOptions), syntheticRequest(def, 'schema'), context),
      ) ?? []
    },
    async healthCheck(_uid, context) {
      return def.connector?.healthCheck?.(def.options ?? ({} as TOptions), context)
        ?? { ok: false, message: 'healthCheck not supported' }
    },
    async validateQuery(_uid, query, context) {
      return def.editor?.validateQuery?.(
        query,
        toQueryContext(def.options ?? ({} as TOptions), syntheticRequest(def, 'validation'), context),
      ) ?? { valid: true }
    },
  }
  return adapter
}

export function createDatasourceAdapter(
  datasources: readonly TestDatasourceAdapter[],
): DashboardDatasourceAdapter {
  const byUid = new Map(datasources.map((ds) => [ds.uid, ds]))
  const get = (uid: string) => byUid.get(uid)
  return {
    validateRequest(request, context) {
      const ds = get(request.uid)
      if (!ds) throw new Error(`datasource "${request.uid}" not found`)
      ds.validateRequest?.(request, context)
    },
    query(request, context) {
      const ds = get(request.uid)
      if (!ds) return Promise.reject(new Error(`datasource "${request.uid}" not found`))
      return ds.query(request, context)
    },
    subscribe(request, context, onData, onError) {
      return get(request.uid)?.subscribe?.(request, context, onData, onError) ?? null
    },
    metricFindQuery(request, context) {
      return get(request.uid)?.metricFindQuery?.(request, context) ?? Promise.resolve([])
    },
    queryAnnotations(query, context) {
      return get(query.datasourceUid)?.queryAnnotations?.(query, context) ?? Promise.resolve([])
    },
    listNamespaces(uid, context) {
      return get(uid)?.listNamespaces?.(uid, context) ?? Promise.resolve([])
    },
    listFields(uid, request, context) {
      return get(uid)?.listFields?.(uid, request, context) ?? Promise.resolve([])
    },
    healthCheck(uid, context) {
      return get(uid)?.healthCheck?.(uid, context) ?? Promise.resolve({ ok: false, message: 'healthCheck not supported' })
    },
    validateQuery(uid, query, context) {
      return get(uid)?.validateQuery?.(uid, query, context) ?? Promise.resolve({ valid: true })
    },
  }
}
