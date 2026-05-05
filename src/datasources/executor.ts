import type { QueryContext } from '@loykin/datasourcekit'
import type {
  Annotation,
  AnnotationQuery,
  DataRequestConfig,
  DatasourcePluginDef,
  PanelConfig,
  PanelRuntimeInstance,
  QueryOptions,
  QueryResult,
  VariableOption,
} from '../schema'
import type {
  DatasourceHealthResult,
  DatasourceSchemaField,
  DatasourceSchemaFieldRequest,
  DatasourceSchemaNamespace,
  DatasourceValidationResult,
} from '../plugins'
import type { DatasourceRegistry } from './registry'

export interface DashboardDatasourceQueryContext extends QueryContext {
  dashboardId: string
  panelId: string
  requestId: string
  panel?: PanelConfig
  panelOptions?: Record<string, unknown>
  panelInstance?: PanelRuntimeInstance
}

export interface DashboardDatasourceExecutor {
  query(
    request: DataRequestConfig,
    context: DashboardDatasourceQueryContext,
  ): Promise<QueryResult>

  subscribe(
    request: DataRequestConfig,
    context: DashboardDatasourceQueryContext,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ): (() => void) | null

  queryAnnotations(
    annotationQuery: AnnotationQuery,
    context: DashboardDatasourceQueryContext,
  ): Promise<Annotation[]>

  metricFindQuery(
    request: DataRequestConfig,
    context: QueryContext,
  ): Promise<VariableOption[]>

  listNamespaces(
    datasourceUid: string,
    context: QueryContext,
  ): Promise<DatasourceSchemaNamespace[]>

  listFields(
    datasourceUid: string,
    request: DatasourceSchemaFieldRequest,
    context: QueryContext,
  ): Promise<DatasourceSchemaField[]>

  healthCheck(
    datasourceUid: string,
    context: QueryContext,
  ): Promise<DatasourceHealthResult>

  validateQuery(
    datasourceUid: string,
    query: unknown,
    context: QueryContext,
  ): Promise<DatasourceValidationResult>
}

function buildQueryOptions(
  dsDef: DatasourcePluginDef,
  request: DataRequestConfig,
  context: DashboardDatasourceQueryContext,
): QueryOptions {
  return {
    dataRequest: request,
    dashboardId: context.dashboardId,
    panelId: context.panelId,
    requestId: context.requestId,
    ...(request.query !== undefined ? { query: request.query } : {}),
    requestOptions: request.options,
    variables: context.variables ?? {},
    datasourceOptions: dsDef.options ?? {},
    ...(context.authContext !== undefined ? { authContext: context.authContext } : {}),
    ...(context.timeRange !== undefined ? { timeRange: context.timeRange } : {}),
    ...(context.signal !== undefined ? { signal: context.signal } : {}),
    ...(context.builtins !== undefined ? { builtins: context.builtins } : {}),
    ...(context.panel !== undefined ? { panel: context.panel } : {}),
    ...(context.panelOptions !== undefined ? { panelOptions: context.panelOptions } : {}),
    ...(context.panelInstance !== undefined ? { panelInstance: context.panelInstance } : {}),
  }
}

export function createDashboardDatasourceExecutor(
  registry: DatasourceRegistry,
): DashboardDatasourceExecutor {
  return {
    query(request, context) {
      const dsDef = registry.getForRequest(request)
      return dsDef.query(buildQueryOptions(dsDef, request, context))
    },

    subscribe(request, context, onData, onError) {
      const dsDef = registry.getForRequest(request)
      if (!dsDef.subscribe) return null
      return dsDef.subscribe(buildQueryOptions(dsDef, request, context), onData, onError)
    },

    async queryAnnotations(annotationQuery, context) {
      const dsDef = registry.get(annotationQuery.datasourceUid)
      if (!dsDef?.queryAnnotations) return []
      return dsDef.queryAnnotations(
        annotationQuery,
        buildQueryOptions(
          dsDef,
          {
            id: annotationQuery.id,
            uid: annotationQuery.datasourceUid,
            type: dsDef.type,
            query: annotationQuery.query,
            options: {},
            hide: false,
            permissions: [],
            staleWhileRevalidate: false,
          },
          context,
        ),
      )
    },

    async metricFindQuery(request, context) {
      if (!request.query || typeof request.query !== 'string') return []
      const dsDef = registry.getForRequest(request)
      if (dsDef.variable?.metricFindQuery) {
        return dsDef.variable.metricFindQuery(request.query, {
          datasourceOptions: dsDef.options ?? {},
          variables: context.variables ?? {},
          ...(context.timeRange !== undefined ? { timeRange: context.timeRange } : {}),
          ...(context.authContext !== undefined ? { authContext: context.authContext } : {}),
        })
      }
      if (!dsDef.metricFindQuery) return []
      return dsDef.metricFindQuery(request.query, context.variables ?? {})
    },

    async listNamespaces(datasourceUid, context) {
      const dsDef = registry.get(datasourceUid)
      if (!dsDef?.schema?.listNamespaces) return []
      return dsDef.schema.listNamespaces({
        datasourceOptions: dsDef.options ?? {},
        variables: context.variables ?? {},
        ...(context.timeRange !== undefined ? { timeRange: context.timeRange } : {}),
        ...(context.authContext !== undefined ? { authContext: context.authContext } : {}),
      })
    },

    async listFields(datasourceUid, request, context) {
      const dsDef = registry.get(datasourceUid)
      if (!dsDef?.schema?.listFields) return []
      return dsDef.schema.listFields(request, {
        datasourceOptions: dsDef.options ?? {},
        variables: context.variables ?? {},
        ...(context.timeRange !== undefined ? { timeRange: context.timeRange } : {}),
        ...(context.authContext !== undefined ? { authContext: context.authContext } : {}),
      })
    },

    async healthCheck(datasourceUid, context) {
      const dsDef = registry.get(datasourceUid)
      if (!dsDef?.connector?.healthCheck) return { ok: false, message: 'healthCheck not supported' }
      return dsDef.connector.healthCheck(
        dsDef.options ?? {},
        context.authContext !== undefined ? { authContext: context.authContext } : {},
      )
    },

    async validateQuery(datasourceUid, query, context) {
      const dsDef = registry.get(datasourceUid)
      if (!dsDef?.editor?.validateQuery) return { valid: true }
      return dsDef.editor.validateQuery(query, {
        datasourceOptions: dsDef.options ?? {},
        variables: context.variables ?? {},
        ...(context.timeRange !== undefined ? { timeRange: context.timeRange } : {}),
        ...(context.authContext !== undefined ? { authContext: context.authContext } : {}),
      })
    },
  }
}
