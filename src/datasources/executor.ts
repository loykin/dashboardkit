import { DatasourceCapabilityError } from '@loykin/datasourcekit'
import type { Annotation as KitAnnotation, DataQuery, QueryContext } from '@loykin/datasourcekit'
import type {
  Annotation,
  AnnotationQuery,
  DataRequestConfig,
  DatasourcePluginDef,
  PanelConfig,
  PanelRuntimeInstance,
  QueryResult,
  VariableOption,
} from '../schema'
import type {
  DashboardDatasourceQueryContext as PluginDashboardDatasourceQueryContext,
  DatasourceHealthResult,
  DatasourceSchemaField,
  DatasourceSchemaFieldRequest,
  DatasourceSchemaNamespace,
  DatasourceValidationResult,
} from '../plugins'
import type { DatasourceRegistry } from './registry'

export interface DashboardDatasourceOperationContext extends QueryContext {
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
    context: DashboardDatasourceOperationContext,
  ): Promise<QueryResult>

  subscribe(
    request: DataRequestConfig,
    context: DashboardDatasourceOperationContext,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ): (() => void) | null

  queryAnnotations(
    annotationQuery: AnnotationQuery,
    context: DashboardDatasourceOperationContext,
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
  request: DataRequestConfig,
): DataQuery {
  return {
    id: request.id,
    datasourceUid: request.uid,
    datasourceType: request.type,
    ...(request.query !== undefined ? { query: request.query } : {}),
    options: request.options,
    ...(request.cacheTtlMs !== undefined ? { cacheTtlMs: request.cacheTtlMs } : {}),
    staleWhileRevalidate: request.staleWhileRevalidate,
    permissions: request.permissions,
  }
}

function buildQueryContext(
  dsDef: DatasourcePluginDef,
  context: DashboardDatasourceOperationContext,
): PluginDashboardDatasourceQueryContext {
  return {
    variables: context.variables ?? {},
    datasourceOptions: dsDef.options ?? {},
    dashboardId: context.dashboardId,
    panelId: context.panelId,
    requestId: context.requestId,
    ...(context.authContext !== undefined ? { authContext: context.authContext } : {}),
    ...(context.timeRange !== undefined ? { timeRange: context.timeRange } : {}),
    ...(context.signal !== undefined ? { signal: context.signal } : {}),
    ...(context.builtins !== undefined ? { builtins: context.builtins } : {}),
    ...(context.panel !== undefined ? { panel: context.panel } : {}),
    ...(context.panelOptions !== undefined ? { panelOptions: context.panelOptions } : {}),
    ...(context.panelInstance !== undefined ? { panelInstance: context.panelInstance } : {}),
    meta: {
      ...(context.meta ?? {}),
      dashboardId: context.dashboardId,
      panelId: context.panelId,
      requestId: context.requestId,
      ...(context.panel !== undefined ? { panel: context.panel } : {}),
      ...(context.panelOptions !== undefined ? { panelOptions: context.panelOptions } : {}),
      ...(context.panelInstance !== undefined ? { panelInstance: context.panelInstance } : {}),
    },
  }
}

function normalizeAnnotation(annotation: KitAnnotation): Annotation {
  return {
    ...(annotation.id !== undefined ? { id: annotation.id } : {}),
    time: annotation.time,
    ...(annotation.timeEnd !== undefined ? { timeEnd: annotation.timeEnd } : {}),
    ...(annotation.title !== undefined ? { title: annotation.title } : {}),
    ...(annotation.text !== undefined ? { text: annotation.text } : {}),
    ...(annotation.tags !== undefined ? { tags: annotation.tags } : {}),
    ...(annotation.color !== undefined ? { color: annotation.color } : {}),
  }
}

function buildAnnotationQuery(annotationQuery: AnnotationQuery) {
  return {
    id: annotationQuery.id,
    datasourceUid: annotationQuery.datasourceUid,
    name: annotationQuery.name,
    query: annotationQuery.query,
    hide: annotationQuery.hide,
    ...(annotationQuery.color !== undefined ? { color: annotationQuery.color } : {}),
  }
}

export function createDashboardDatasourceExecutor(
  registry: DatasourceRegistry,
): DashboardDatasourceExecutor {
  return {
    query(request, context) {
      const dsDef = registry.getForRequest(request)
      if (!dsDef.queryData) throw new DatasourceCapabilityError(request.uid, 'query')
      return dsDef.queryData(buildQueryOptions(request), buildQueryContext(dsDef, context))
    },

    subscribe(request, context, onData, onError) {
      const dsDef = registry.getForRequest(request)
      if (!dsDef.subscribeData) return null
      return dsDef.subscribeData(
        buildQueryOptions(request),
        buildQueryContext(dsDef, context),
        onData,
        onError,
      )
    },

    async queryAnnotations(annotationQuery, context) {
      const dsDef = registry.get(annotationQuery.datasourceUid)
      if (!dsDef?.annotations?.queryAnnotations) return []
      const annotations = await dsDef.annotations.queryAnnotations(
        buildAnnotationQuery(annotationQuery),
        buildQueryContext(dsDef, context),
      )
      return annotations.map(normalizeAnnotation)
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
      return []
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
