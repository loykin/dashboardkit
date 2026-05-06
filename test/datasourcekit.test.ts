import test from 'node:test'
import assert from 'node:assert/strict'

import { defineDatasource } from './helpers.ts'
import {
  builtinVariableTypes,
  createDashboardEngine,
} from '@loykin/dashboardkit'

test('dashboard engine executeDataRequest can run without loading a dashboard', async () => {
  let called = false
  const ds = defineDatasource<Record<string, unknown>>({
    uid: 'api',
    type: 'mock',
    async queryData(_request, options) {
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

  const engine = createDashboardEngine({ datasourceAdapter: ds })
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

test('dashboard engine can use a datasource adapter without datasource plugins', async () => {
  const calls: string[] = []
  const engine = createDashboardEngine({
    datasourceAdapter: {
      async query(request, context) {
        calls.push(`query:${request.uid}:${request.type}:${context.dashboardId}:${context.panelId}`)
        return {
          columns: [{ name: 'value', type: 'number' }],
          rows: [[context.variables['country']]],
        }
      },
      async metricFindQuery(request, context) {
        calls.push(`variable:${request.uid}:${request.type}:${context.variables['env']}`)
        return [{ label: 'Korea', value: 'KR' }]
      },
    },
    variableTypes: builtinVariableTypes,
  })

  engine.load({
    schemaVersion: 1,
    id: 'adapter-dashboard',
    title: 'Adapter Dashboard',
    variables: [
      { name: 'env', type: 'constant', defaultValue: 'prod' },
      {
        name: 'country',
        type: 'query',
        dataRequest: { id: 'countries', uid: 'remote-api', type: 'rest', query: 'countries' },
      },
    ],
    panels: [
      {
        id: 'p1',
        type: 'table',
        title: 'Panel',
        gridPos: { x: 0, y: 0, w: 12, h: 4 },
        dataRequests: [{ id: 'main', uid: 'remote-api', type: 'rest', query: 'series' }],
      },
    ],
  })

  await new Promise<void>((resolve) => setTimeout(resolve, 30))

  assert.equal(engine.getVariable('country')?.value, 'KR')
  assert.deepEqual(engine.getPanel('p1')?.rawData?.[0]?.rows, [['KR']])
  assert.deepEqual(calls, [
    'variable:remote-api:rest:prod',
    'query:remote-api:rest:adapter-dashboard:p1',
  ])
})

test('dashboard engine reports a clear error when datasource adapter is missing', async () => {
  const engine = createDashboardEngine()

  await assert.rejects(
    engine.executeDataRequest({ id: 'main', uid: 'api', type: 'rest', query: 'select 1' }),
    /No datasource adapter configured/,
  )
})

test('query variables resolve through datasource variable support', async () => {
  const calls: string[] = []
  const ds = defineDatasource<Record<string, unknown>>({
    uid: 'api',
    type: 'mock',
    variable: {
      async metricFindQuery(query, context) {
        calls.push(`variable:${query}:${context.variables['env'] ?? ''}`)
        return [{ label: 'Korea', value: 'KR' }]
      },
    },
    async queryData() {
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({
    datasourceAdapter: ds,
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

test('dashboard engine exposes datasource capability APIs without loading a dashboard', async () => {
  const calls: string[] = []
  const ds = defineDatasource<Record<string, unknown>>({
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
    async queryData() {
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ datasourceAdapter: ds })

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
