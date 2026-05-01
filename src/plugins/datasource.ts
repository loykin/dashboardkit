import type {
  AuthContext,
  QueryOptions,
  QueryResult,
  VariableOption,
} from '../schema'
import type { OptionSchema } from '../schema'
import type { PluginComponent } from './panel'

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

export interface DatasourceEditorContext<TOptions> {
  datasourceOptions: TOptions
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  authContext?: AuthContext
}

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

export interface DatasourceEditorSupport<TOptions, TQuery> {
  querySchema?: OptionSchema
  defaultQuery?: TQuery
  queryEditor?: PluginComponent<DatasourceQueryEditorProps<TOptions, TQuery>>
  validateQuery?(
    query: TQuery,
    ctx: DatasourceEditorContext<TOptions>,
  ): Promise<DatasourceValidationResult> | DatasourceValidationResult
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

export interface DatasourcePluginDef<
  TOptions = Record<string, unknown>,
  TQuery = unknown,
> {
  uid: string
  type: string
  name?: string
  options?: TOptions
  optionsSchema?: OptionSchema
  query: (options: QueryOptions<TOptions>) => Promise<QueryResult>
  metricFindQuery?: (
    query: string,
    vars: Record<string, string | string[]>,
  ) => Promise<VariableOption[]>
  variable?: DatasourceVariableSupport<TOptions>
  editor?: DatasourceEditorSupport<TOptions, TQuery>
  connector?: DatasourceConnectorSupport<TOptions>
  schema?: DatasourceSchemaSupport<TOptions>
}
