import { DatasourceCapabilityError } from './errors'
import { createDatasourceRegistry } from './registry'
import type {
  Annotation,
  AnnotationQuery,
  AuthorizationDecision,
  DataAuthorizationRequest,
  DataQuery,
  DatasourceHealthResult,
  DatasourcePluginDef,
  DatasourceRegistry,
  DatasourceSchemaField,
  DatasourceSchemaFieldRequest,
  DatasourceSchemaNamespace,
  DatasourceValidationResult,
  QueryContext,
  QueryResult,
} from './internal-types'

export interface CreateDatasourceExecutorOptions {
  datasources?: readonly DatasourcePluginDef[]
  registry?: DatasourceRegistry
  authContext?: QueryContext['authContext']
  authorize?: (
    request: DataAuthorizationRequest,
  ) => boolean | AuthorizationDecision | Promise<boolean | AuthorizationDecision>
  onDenied?: (request: DataAuthorizationRequest, decision: AuthorizationDecision) => void
}

function normalizeDecision(value: boolean | AuthorizationDecision): AuthorizationDecision {
  return typeof value === 'boolean' ? { allowed: value } : value
}

function authorizationRequest(
  request: {
    action: DataAuthorizationRequest['action']
    datasourceUid: string
    datasourceType?: string
    query?: DataQuery
    context: QueryContext
  },
): DataAuthorizationRequest {
  return {
    action: request.action,
    datasourceUid: request.datasourceUid,
    ...(request.datasourceType !== undefined ? { datasourceType: request.datasourceType } : {}),
    ...(request.query !== undefined ? { query: request.query } : {}),
    context: request.context,
  }
}

async function ensureAuthorized(
  options: CreateDatasourceExecutorOptions,
  request: DataAuthorizationRequest,
): Promise<void> {
  if (!options.authorize) return
  const decision = normalizeDecision(await options.authorize(request))
  if (decision.allowed) return
  options.onDenied?.(request, decision)
  throw new Error(decision.reason ?? `not authorized for ${request.action}`)
}

export interface DatasourceExecutor {
  query<TQuery = unknown>(
    request: DataQuery<TQuery>,
    context?: QueryContext,
  ): Promise<QueryResult>

  subscribe<TQuery = unknown>(
    request: DataQuery<TQuery>,
    context: QueryContext,
    onData: (result: QueryResult) => void,
    onError: (error: Error) => void,
  ): () => void

  listNamespaces(
    datasourceUid: string,
    context?: QueryContext,
  ): Promise<DatasourceSchemaNamespace[]>

  listFields(
    datasourceUid: string,
    request: DatasourceSchemaFieldRequest,
    context?: QueryContext,
  ): Promise<DatasourceSchemaField[]>

  healthCheck(
    datasourceUid: string,
    context?: QueryContext,
  ): Promise<DatasourceHealthResult>

  validateQuery<TQuery = unknown>(
    datasourceUid: string,
    query: TQuery,
    context?: QueryContext,
  ): Promise<DatasourceValidationResult>

  queryAnnotations<TQuery = unknown>(
    annotationQuery: AnnotationQuery<TQuery>,
    context?: QueryContext,
  ): Promise<Annotation[]>
}

export function createDatasourceExecutor(
  options: CreateDatasourceExecutorOptions = {},
): DatasourceExecutor {
  const registry = options.registry ?? createDatasourceRegistry(options.datasources ?? [])

  function withDefaults(context: QueryContext = {}): QueryContext {
    const authContext = context.authContext ?? options.authContext
    return {
      ...context,
      ...(authContext !== undefined ? { authContext } : {}),
    }
  }

  return {
    async query(request, context = {}) {
      const ctx = withDefaults(context)
      const ds = registry.getForRequest(request)
      await ensureAuthorized(options, authorizationRequest({
        action: 'datasource:query',
        datasourceUid: request.datasourceUid,
        ...(request.datasourceType !== undefined ? { datasourceType: request.datasourceType } : {}),
        query: request,
        context: ctx,
      }))
      if (!ds.queryData) throw new DatasourceCapabilityError(request.datasourceUid, 'query')
      return ds.queryData(request, {
        ...ctx,
        datasourceOptions: ds.options ?? {},
      })
    },

    subscribe(request, context, onData, onError) {
      const ctx = withDefaults(context)
      const ds = registry.getForRequest(request)
      void ensureAuthorized(options, authorizationRequest({
        action: 'datasource:subscribe',
        datasourceUid: request.datasourceUid,
        ...(request.datasourceType !== undefined ? { datasourceType: request.datasourceType } : {}),
        query: request,
        context: ctx,
      })).catch(onError)
      if (ds.subscribeData) {
        return ds.subscribeData(
          request,
          {
            ...ctx,
            datasourceOptions: ds.options ?? {},
          },
          onData,
          onError,
        )
      }
      throw new DatasourceCapabilityError(request.datasourceUid, 'subscribe')
    },

    async listNamespaces(datasourceUid, context = {}) {
      const ctx = withDefaults(context)
      const ds = registry.get(datasourceUid)
      if (!ds) throw new DatasourceCapabilityError(datasourceUid, 'schema')
      if (!ds.schema?.listNamespaces) throw new DatasourceCapabilityError(datasourceUid, 'schema')
      await ensureAuthorized(options, authorizationRequest({
        action: 'datasource:schema',
        datasourceUid,
        datasourceType: ds.type,
        context: ctx,
      }))
      return ds.schema.listNamespaces({
        datasourceOptions: ds.options ?? {},
        variables: ctx.variables ?? {},
        ...(ctx.timeRange ? { timeRange: ctx.timeRange } : {}),
        ...(ctx.authContext !== undefined ? { authContext: ctx.authContext } : {}),
      })
    },

    async listFields(datasourceUid, request, context = {}) {
      const ctx = withDefaults(context)
      const ds = registry.get(datasourceUid)
      if (!ds) throw new DatasourceCapabilityError(datasourceUid, 'schema')
      if (!ds.schema?.listFields) throw new DatasourceCapabilityError(datasourceUid, 'schema')
      await ensureAuthorized(options, authorizationRequest({
        action: 'datasource:schema',
        datasourceUid,
        datasourceType: ds.type,
        context: ctx,
      }))
      return ds.schema.listFields(request, {
        datasourceOptions: ds.options ?? {},
        variables: ctx.variables ?? {},
        ...(ctx.timeRange ? { timeRange: ctx.timeRange } : {}),
        ...(ctx.authContext !== undefined ? { authContext: ctx.authContext } : {}),
      })
    },

    async healthCheck(datasourceUid, context = {}) {
      const ctx = withDefaults(context)
      const ds = registry.get(datasourceUid)
      if (!ds) throw new DatasourceCapabilityError(datasourceUid, 'healthCheck')
      if (!ds.connector?.healthCheck) throw new DatasourceCapabilityError(datasourceUid, 'healthCheck')
      await ensureAuthorized(options, authorizationRequest({
        action: 'datasource:health',
        datasourceUid,
        datasourceType: ds.type,
        context: ctx,
      }))
      return ds.connector.healthCheck(
        ds.options ?? {},
        ctx.authContext !== undefined ? { authContext: ctx.authContext } : {},
      )
    },

    async validateQuery(datasourceUid, query, context = {}) {
      const ctx = withDefaults(context)
      const ds = registry.get(datasourceUid)
      if (!ds) throw new DatasourceCapabilityError(datasourceUid, 'validateQuery')
      if (!ds.editor?.validateQuery) throw new DatasourceCapabilityError(datasourceUid, 'validateQuery')
      return ds.editor.validateQuery(query, {
        datasourceOptions: ds.options ?? {},
        variables: ctx.variables ?? {},
        ...(ctx.timeRange ? { timeRange: ctx.timeRange } : {}),
        ...(ctx.authContext !== undefined ? { authContext: ctx.authContext } : {}),
      })
    },

    async queryAnnotations(annotationQuery, context = {}) {
      const ctx = withDefaults(context)
      const ds = registry.get(annotationQuery.datasourceUid)
      if (!ds) throw new DatasourceCapabilityError(annotationQuery.datasourceUid, 'annotations')
      await ensureAuthorized(options, authorizationRequest({
        action: 'datasource:query',
        datasourceUid: annotationQuery.datasourceUid,
        datasourceType: ds.type,
        context: ctx,
      }))

      if (ds.annotations?.queryAnnotations) {
        return ds.annotations.queryAnnotations(annotationQuery, {
          ...ctx,
          datasourceOptions: ds.options ?? {},
        })
      }
      throw new DatasourceCapabilityError(annotationQuery.datasourceUid, 'annotations')
    },
  }
}
