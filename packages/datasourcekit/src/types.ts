import type { OptionSchema } from './options'

export interface AuthSubject {
  id: string
  roles?: string[]
  groups?: string[]
  attributes?: Record<string, unknown>
}

export interface AuthContext {
  subject?: AuthSubject
  tenantId?: string
  attributes?: Record<string, unknown>
}

export interface DataQuery<TQuery = unknown> {
  id: string
  datasourceUid: string
  datasourceType?: string
  query?: TQuery
  options?: Record<string, unknown>
  cacheTtlMs?: number
  staleWhileRevalidate?: boolean
  permissions?: unknown[]
  meta?: Record<string, unknown>
}

export interface QueryContext {
  variables?: Record<string, string | string[]>
  timeRange?: { from: string; to: string; raw?: { from: string; to: string } }
  authContext?: AuthContext
  signal?: AbortSignal
  builtins?: Record<string, string>
  meta?: Record<string, unknown>
}

export interface QueryResult {
  columns: Array<{ name: string; type: string; meta?: Record<string, unknown> }>
  rows: unknown[][]
  requestId?: string
  meta?: Record<string, unknown>
}

export interface VariableOption {
  label: string
  value: string
}

export type PluginComponent<Props> = (props: Props) => unknown

export interface DatasourceValidationResult {
  valid: boolean
  errors?: string[]
}

export interface DatasourceQueryEditorProps<TOptions, TQuery> {
  datasourceUid: string
  datasourceOptions: TOptions
  query: TQuery
  requestOptions: Record<string, unknown>
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  onQueryChange(query: TQuery): void
  onRequestOptionsChange(options: Record<string, unknown>): void
  preview(): Promise<QueryResult>
}

export interface DatasourceEditorContext<TOptions> {
  datasourceOptions: TOptions
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  authContext?: AuthContext
}

export interface DatasourceEditorSupport<TOptions, TQuery> {
  querySchema?: OptionSchema
  defaultQuery?: TQuery
  queryEditor?: PluginComponent<DatasourceQueryEditorProps<TOptions, TQuery>>
  validateQuery?(
    query: TQuery,
    ctx: DatasourceEditorContext<TOptions>,
  ): Promise<DatasourceValidationResult> | DatasourceValidationResult
}

export interface DatasourceVariableContext<TOptions> {
  datasourceOptions: TOptions
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  authContext?: AuthContext
}

export interface DatasourceVariableSupport<TOptions> {
  metricFindQuery(
    query: string,
    ctx: DatasourceVariableContext<TOptions>,
  ): Promise<VariableOption[]>
}

export interface DatasourceHealthResult {
  ok: boolean
  message?: string
  details?: Record<string, unknown>
}

export interface DatasourceConnectorContext {
  authContext?: AuthContext
}

export interface DatasourceConnectorActions<TOptions> {
  validate(value: Partial<TOptions>): DatasourceValidationResult
  healthCheck(value: Partial<TOptions>): Promise<DatasourceHealthResult>
}

export interface DatasourceConfigEditorProps<TOptions> {
  value: Partial<TOptions>
  onChange(value: Partial<TOptions>): void
  connector: DatasourceConnectorActions<TOptions>
}

export interface DatasourceConnectorSupport<TOptions> {
  configSchema: OptionSchema
  defaultConfig?: Partial<TOptions>
  configEditor?: PluginComponent<DatasourceConfigEditorProps<TOptions>>
  healthCheck?(
    options: TOptions,
    ctx: DatasourceConnectorContext,
  ): Promise<DatasourceHealthResult>
}

export interface DatasourceSchemaContext<TOptions> {
  datasourceOptions: TOptions
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  authContext?: AuthContext
}

export interface DatasourceSchemaNamespace {
  id: string
  name: string
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

export interface DatasourceSchemaSupport<TOptions> {
  listNamespaces?(ctx: DatasourceSchemaContext<TOptions>): Promise<DatasourceSchemaNamespace[]>
  listFields?(
    request: DatasourceSchemaFieldRequest,
    ctx: DatasourceSchemaContext<TOptions>,
  ): Promise<DatasourceSchemaField[]>
}

export interface AnnotationQuery<TQuery = unknown> {
  id: string
  datasourceUid: string
  name?: string
  query?: TQuery
  options?: Record<string, unknown>
  hide?: boolean
  color?: string
}

export interface Annotation {
  id?: string
  time: number
  timeEnd?: number
  title?: string
  text?: string
  tags?: string[]
  color?: string
  source?: AnnotationQuery
  meta?: Record<string, unknown>
}

export interface DatasourceAnnotationSupport<TOptions, TQuery = unknown> {
  queryAnnotations(
    annotationQuery: AnnotationQuery<TQuery>,
    context: QueryContext & { datasourceOptions: TOptions },
  ): Promise<Annotation[]>
}

export type DatasourceQueryContext<TOptions> = QueryContext & {
  datasourceOptions: TOptions
}

export interface DatasourcePluginDef<
  TOptions = Record<string, unknown>,
  TQuery = unknown,
> {
  uid: string
  type: string
  name?: string
  options?: TOptions
  optionsSchema?: OptionSchema
  cacheTtlMs?: number
  queryData?: (
    request: DataQuery<TQuery>,
    context: DatasourceQueryContext<TOptions>,
  ) => Promise<QueryResult>
  subscribeData?: (
    request: DataQuery<TQuery>,
    context: DatasourceQueryContext<TOptions>,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ) => () => void
  variable?: DatasourceVariableSupport<TOptions>
  editor?: DatasourceEditorSupport<TOptions, TQuery>
  connector?: DatasourceConnectorSupport<TOptions>
  schema?: DatasourceSchemaSupport<TOptions>
  annotations?: DatasourceAnnotationSupport<TOptions, TQuery>
}

export interface DataAuthorizationRequest {
  action:
    | 'datasource:query'
    | 'datasource:subscribe'
    | 'datasource:schema'
    | 'datasource:health'
  datasourceUid: string
  datasourceType?: string
  query?: DataQuery
  context: QueryContext
}

export interface AuthorizationDecision {
  allowed: boolean
  reason?: string
}
