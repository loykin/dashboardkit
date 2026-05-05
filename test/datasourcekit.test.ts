import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDatasourceExecutor,
  defineDatasource,
} from '@loykin/datasourcekit'
import {
  builtinVariableTypes,
  createDashboardEngine,
  defineDatasource as defineDashboardDatasource,
} from '@loykin/dashboardkit'

test('datasourcekit executor supports dashboard-independent queryData plugins', async () => {
  const ds = defineDatasource<Record<string, unknown>>({
    uid: 'api',
    type: 'mock',
    options: { baseUrl: 'https://example.test' },
    async queryData(request, context) {
      assert.equal(request.id, 'standalone')
      assert.equal(request.datasourceUid, 'api')
      assert.equal(context.variables?.['region'], 'KR')
      assert.equal(context.authContext?.tenantId, 'tenant-a')
      assert.deepEqual(context.datasourceOptions, { baseUrl: 'https://example.test' })
      return {
        columns: [{ name: 'value', type: 'number' }],
        rows: [[1]],
      }
    },
  })

  const executor = createDatasourceExecutor({ datasources: [ds] })
  const result = await executor.query(
    { id: 'standalone', datasourceUid: 'api', datasourceType: 'mock', query: 'select 1' },
    {
      variables: { region: 'KR' },
      authContext: { tenantId: 'tenant-a' },
    },
  )

  assert.deepEqual(result.rows, [[1]])
})

test('dashboard engine executeDataRequest can run without loading a dashboard', async () => {
  let called = false
  const ds = defineDashboardDatasource<Record<string, unknown>>({
    uid: 'api',
    type: 'mock',
    async query(options) {
      called = true
      assert.equal(options.dashboardId, '')
      assert.equal(options.panelId, '')
      assert.equal(options.requestId, 'standalone')
      assert.equal(options.variables['region'], 'KR')
      assert.equal(options.timeRange?.raw?.from, 'now-1h')
      assert.equal(options.authContext?.tenantId, 'tenant-a')
      return {
        columns: [{ name: 'value', type: 'number' }],
        rows: [[2]],
      }
    },
  })

  const engine = createDashboardEngine({ datasourcePlugins: [ds] })
  const result = await engine.executeDataRequest(
    { id: 'standalone', uid: 'api', type: 'mock', query: 'select 2' },
    {
      variablesOverride: { region: 'KR' },
      timeRange: { from: 'now-1h', to: 'now' },
      authContext: { tenantId: 'tenant-a' },
    },
  )

  assert.equal(called, true)
  assert.deepEqual(result.rows, [[2]])
})

test('datasourcekit executor supports annotation plugins', async () => {
  const ds = defineDatasource<Record<string, unknown>>({
    uid: 'events',
    type: 'events',
    annotations: {
      async queryAnnotations(annotationQuery, context) {
        assert.equal(annotationQuery.id, 'deploys')
        assert.equal(context.variables?.['env'], 'prod')
        return [{ time: 123, title: 'Deploy', source: annotationQuery }]
      },
    },
  })

  const executor = createDatasourceExecutor({ datasources: [ds] })
  const annotations = await executor.queryAnnotations(
    { id: 'deploys', datasourceUid: 'events', query: 'deploys' },
    { variables: { env: 'prod' } },
  )

  assert.equal(annotations.length, 1)
  assert.equal(annotations[0]?.time, 123)
  assert.equal(annotations[0]?.source?.id, 'deploys')
})

test('query variables resolve through datasource variable support', async () => {
  const calls: string[] = []
  const ds = defineDashboardDatasource<Record<string, unknown>>({
    uid: 'api',
    type: 'mock',
    variable: {
      async metricFindQuery(query, context) {
        calls.push(`variable:${query}:${context.variables['env'] ?? ''}`)
        return [{ label: 'Korea', value: 'KR' }]
      },
    },
    async metricFindQuery(query) {
      calls.push(`fallback:${query}`)
      return [{ label: 'Fallback', value: 'fallback' }]
    },
    async query() {
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({
    datasourcePlugins: [ds],
    variableTypes: builtinVariableTypes,
  })

  engine.load({
    schemaVersion: 1,
    id: 'vars',
    title: 'Vars',
    variables: [
      { name: 'env', type: 'constant', defaultValue: 'prod' },
      {
        name: 'country',
        type: 'query',
        dataRequest: { id: 'countries', uid: 'api', type: 'mock', query: 'countries' },
      },
    ],
    panels: [],
  })

  await new Promise<void>((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(calls, ['variable:countries:prod'])
  assert.equal(engine.getVariable('country')?.value, 'KR')
})

test('datasourcekit executor runs schema, health, and query validation capabilities', async () => {
  const ds = defineDatasource<Record<string, unknown>>({
    uid: 'catalog',
    type: 'mock',
    options: { endpoint: 'local' },
    editor: {
      validateQuery(query, context) {
        assert.equal(query, 'select *')
        assert.deepEqual(context.datasourceOptions, { endpoint: 'local' })
        return { valid: true }
      },
    },
    connector: {
      configSchema: {},
      async healthCheck(options, context) {
        assert.deepEqual(options, { endpoint: 'local' })
        assert.equal(context.authContext?.tenantId, 'tenant-a')
        return { ok: true, message: 'ok' }
      },
    },
    schema: {
      async listNamespaces(context) {
        assert.equal(context.variables['env'], 'prod')
        return [{ id: 'public', name: 'Public', kind: 'schema' }]
      },
      async listFields(request) {
        assert.equal(request.namespaceId, 'public.users')
        return [{ name: 'id', type: 'number' }]
      },
    },
  })

  const executor = createDatasourceExecutor({
    datasources: [ds],
    authContext: { tenantId: 'tenant-a' },
  })

  assert.deepEqual(
    await executor.listNamespaces('catalog', { variables: { env: 'prod' } }),
    [{ id: 'public', name: 'Public', kind: 'schema' }],
  )
  assert.deepEqual(
    await executor.listFields('catalog', { namespaceId: 'public.users' }),
    [{ name: 'id', type: 'number' }],
  )
  assert.deepEqual(await executor.healthCheck('catalog'), { ok: true, message: 'ok' })
  assert.deepEqual(await executor.validateQuery('catalog', 'select *'), { valid: true })
})

test('dashboard engine exposes datasource capability APIs without loading a dashboard', async () => {
  const calls: string[] = []
  const ds = defineDashboardDatasource<Record<string, unknown>>({
    uid: 'catalog',
    type: 'mock',
    options: { endpoint: 'local' },
    editor: {
      validateQuery(query, context) {
        calls.push(`validate:${String(query)}:${context.variables['env'] ?? ''}`)
        return { valid: true }
      },
    },
    connector: {
      configSchema: {},
      async healthCheck(options, context) {
        calls.push(`health:${String(options['endpoint'])}:${context.authContext?.tenantId ?? ''}`)
        return { ok: true }
      },
    },
    schema: {
      async listNamespaces(context) {
        calls.push(`namespaces:${context.variables['env'] ?? ''}`)
        return [{ id: 'public', name: 'Public' }]
      },
      async listFields(request, context) {
        calls.push(`fields:${request.namespaceId}:${context.variables['env'] ?? ''}`)
        return [{ name: 'id', type: 'number' }]
      },
    },
    async query() {
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ datasourcePlugins: [ds] })

  assert.deepEqual(
    await engine.listDatasourceNamespaces('catalog', { variablesOverride: { env: 'prod' } }),
    [{ id: 'public', name: 'Public' }],
  )
  assert.deepEqual(
    await engine.listDatasourceFields('catalog', { namespaceId: 'public.users' }, { variablesOverride: { env: 'prod' } }),
    [{ name: 'id', type: 'number' }],
  )
  assert.deepEqual(
    await engine.healthCheckDatasource('catalog', { authContext: { tenantId: 'tenant-a' } }),
    { ok: true },
  )
  assert.deepEqual(
    await engine.validateDatasourceQuery('catalog', 'select *', { variablesOverride: { env: 'prod' } }),
    { valid: true },
  )
  assert.deepEqual(calls, [
    'namespaces:prod',
    'fields:public.users:prod',
    'health:local:tenant-a',
    'validate:select *:prod',
  ])
})
