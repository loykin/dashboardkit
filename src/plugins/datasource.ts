import type {
  DataQuery,
  DatasourceAnnotationSupport,
  DatasourceConnectorSupport,
  DatasourceEditorSupport,
  DatasourceSchemaSupport,
  DatasourceVariableSupport,
  QueryContext,
} from '@loykin/datasourcekit'
import type { OptionSchema, PanelConfig, PanelRuntimeInstance, QueryResult } from '../schema'

export type {
  DataQuery,
  DatasourceAnnotationSupport,
  DatasourceConfigEditorProps,
  DatasourceConnectorActions,
  DatasourceConnectorContext,
  DatasourceConnectorSupport,
  DatasourceEditorContext,
  DatasourceEditorSupport,
  DatasourceHealthResult,
  DatasourceQueryEditorProps,
  DatasourceSchemaContext,
  DatasourceSchemaField,
  DatasourceSchemaFieldRequest,
  DatasourceSchemaNamespace,
  DatasourceSchemaSupport,
  DatasourceValidationResult,
  DatasourceVariableContext,
  DatasourceVariableSupport,
  QueryContext,
} from '@loykin/datasourcekit'

export type DashboardDatasourceQueryContext<TOptions = Record<string, unknown>> = QueryContext & {
  datasourceOptions: TOptions
  variables: Record<string, string | string[]>
  dashboardId: string
  panelId: string
  requestId: string
  panel?: PanelConfig
  panelOptions?: Record<string, unknown>
  panelInstance?: PanelRuntimeInstance
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
    context: DashboardDatasourceQueryContext<TOptions>,
  ) => Promise<QueryResult>
  subscribeData?: (
    request: DataQuery<TQuery>,
    context: DashboardDatasourceQueryContext<TOptions>,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ) => () => void
  variable?: DatasourceVariableSupport<TOptions>
  editor?: DatasourceEditorSupport<TOptions, TQuery>
  connector?: DatasourceConnectorSupport<TOptions>
  schema?: DatasourceSchemaSupport<TOptions>
  annotations?: DatasourceAnnotationSupport<TOptions, TQuery>
}
