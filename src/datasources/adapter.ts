import type {
  Annotation,
  AnnotationQuery,
  AuthContext,
  DataRequestConfig,
  PanelConfig,
  PanelRuntimeInstance,
  QueryResult,
  VariableOption,
} from '../schema'

export interface DatasourceHealthResult {
  ok: boolean
  message?: string
  details?: Record<string, unknown>
}

export interface DatasourceSchemaNamespace {
  id: string
  name: string
  label?: string
  description?: string
  kind?: 'database' | 'schema' | 'table' | 'metric' | 'bucket' | 'index' | string
  parentId?: string
  meta?: Record<string, unknown>
}

export interface DatasourceSchemaFieldRequest {
  namespaceId: string
}

export interface DatasourceSchemaField {
  name: string
  type?: string
  label?: string
  description?: string
  meta?: Record<string, unknown>
}

export interface DatasourceValidationResult {
  valid: boolean
  message?: string
  errors?: Array<{ path?: string[]; message: string }>
}

export interface DashboardDatasourceContext {
  dashboardId?: string
  panelId?: string
  requestId?: string
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string; raw?: { from: string; to: string } }
  authContext?: AuthContext
  signal?: AbortSignal
  builtins?: Record<string, string>
  panel?: PanelConfig
  panelOptions?: Record<string, unknown>
  panelInstance?: PanelRuntimeInstance
  meta?: Record<string, unknown>
}

export interface DashboardDatasourceAdapter {
  validateRequest?(
    request: DataRequestConfig,
    context: DashboardDatasourceContext,
  ): void | Promise<void>

  query(
    request: DataRequestConfig,
    context: DashboardDatasourceContext,
  ): Promise<QueryResult>

  subscribe?(
    request: DataRequestConfig,
    context: DashboardDatasourceContext,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ): (() => void) | null | undefined

  metricFindQuery?(
    request: DataRequestConfig,
    context: DashboardDatasourceContext,
  ): Promise<VariableOption[]>

  queryAnnotations?(
    query: AnnotationQuery,
    context: DashboardDatasourceContext,
  ): Promise<Annotation[]>

  listNamespaces?(
    datasourceUid: string,
    context: DashboardDatasourceContext,
  ): Promise<DatasourceSchemaNamespace[]>

  listFields?(
    datasourceUid: string,
    request: DatasourceSchemaFieldRequest,
    context: DashboardDatasourceContext,
  ): Promise<DatasourceSchemaField[]>

  healthCheck?(
    datasourceUid: string,
    context: DashboardDatasourceContext,
  ): Promise<DatasourceHealthResult>

  validateQuery?(
    datasourceUid: string,
    query: unknown,
    context: DashboardDatasourceContext,
  ): Promise<DatasourceValidationResult>

  getCacheTtlMs?(
    request: DataRequestConfig,
    context: DashboardDatasourceContext,
  ): number | undefined
}

export function createMissingDashboardDatasourceAdapter(): DashboardDatasourceAdapter {
  const missing = () => new Error('No datasource adapter configured')
  return {
    validateRequest() {
      return Promise.reject(missing())
    },
    query() {
      return Promise.reject(missing())
    },
    metricFindQuery() {
      return Promise.reject(missing())
    },
    queryAnnotations() {
      return Promise.reject(missing())
    },
    listNamespaces() {
      return Promise.reject(missing())
    },
    listFields() {
      return Promise.reject(missing())
    },
    healthCheck() {
      return Promise.reject(missing())
    },
    validateQuery() {
      return Promise.reject(missing())
    },
  }
}
