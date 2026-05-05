import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createEditorAddon,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import type {
  DashboardInput,
  DataQuery,
  DashboardDatasourceQueryContext,
} from '@loykin/dashboardkit'

const panel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
})

const constantVariableType = defineVariableType({
  id: 'constant',
  name: 'Constant',
  optionsSchema: {},
  async resolve(config) {
    const value = Array.isArray(config.defaultValue)
      ? config.defaultValue[0]
      : config.defaultValue
    return value ? [{ label: value, value }] : []
  },
})

function dashboardConfig(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'sales-dashboard',
    title: 'Sales Dashboard',
    variables: [
      {
        name: 'country',
        type: 'constant',
        defaultValue: 'KR',
        options: {},
      },
    ],
    panels: [
      {
        id: 'sales-table',
        type: 'table',
        title: 'Sales',
        gridPos: { x: 0, y: 0, w: 12, h: 6 },
        dataRequests: [{
          id: 'main',
          uid: 'backend',
          type: 'backend',
          query: 'sales.list',
          options: { limit: 100 },
        }],
        options: {},
      },
    ],
  }
}

test('viewer datasource query sends structured datasource request', async () => {
  let queryCalls = 0
  let lastRequest: DataQuery | undefined
  let lastOptions: DashboardDatasourceQueryContext | undefined
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'backend',
    async queryData(request, options) {
      queryCalls += 1
      lastRequest = request
      lastOptions = options
      return {
        columns: [{ name: 'amount', type: 'number' }],
        rows: [[1200]],
      }
    },
  })
  const engine = createDashboardEngine({
    datasourcePlugins: [datasource],
    panels: [panel],
    variableTypes: [constantVariableType],
    authContext: { subject: { id: 'viewer-1', roles: ['viewer'] } },
    authorize() {
      return true
    },
  })

  engine.load(dashboardConfig())
  await engine.refreshPanel('sales-table')

  assert.equal(queryCalls, 1)
  assert.equal(engine.getPanel('sales-table')?.error, null)
  assert.equal(lastOptions?.dashboardId, 'sales-dashboard')
  assert.equal(lastOptions?.panelId, 'sales-table')
  assert.equal(lastOptions?.requestId, 'main')
  assert.equal(lastRequest?.datasourceUid, 'backend')
  assert.equal(lastRequest?.datasourceType, 'backend')
  assert.equal(lastRequest?.query, 'sales.list')
  assert.deepEqual(lastRequest?.options, { limit: 100 })
  assert.deepEqual(lastOptions?.variables, { country: 'KR' })
  assert.equal(lastOptions?.authContext?.subject?.id, 'viewer-1')
})

test('denied datasource query does not call the datasource plugin', async () => {
  let queryCalls = 0
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'backend',
    async queryData() {
      queryCalls += 1
      return { columns: [], rows: [] }
    },
  })
  const engine = createDashboardEngine({
    datasourcePlugins: [datasource],
    panels: [panel],
    variableTypes: [constantVariableType],
    authContext: { subject: { id: 'blocked-1', roles: ['blocked'] } },
    authorize({ action, authContext }) {
      if (action === 'datasource:query' && authContext.subject?.roles?.includes('blocked')) {
        return { allowed: false, reason: 'blocked role cannot query datasource' }
      }
      return true
    },
  })

  engine.load(dashboardConfig())
  await engine.refreshPanel('sales-table')

  assert.equal(queryCalls, 0)
  assert.equal(engine.getPanel('sales-table')?.error, 'blocked role cannot query datasource')
})

test('denied previewPanel datasource query does not call the datasource plugin', async () => {
  let queryCalls = 0
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'backend',
    async queryData() {
      queryCalls += 1
      return { columns: [], rows: [] }
    },
  })
  const engine = createDashboardEngine({
    datasourcePlugins: [datasource],
    panels: [panel],
    variableTypes: [constantVariableType],
    authContext: { subject: { id: 'blocked-1', roles: ['blocked'] } },
    authorize({ action, authContext }) {
      if (action === 'datasource:query' && authContext.subject?.roles?.includes('blocked')) {
        return { allowed: false, reason: 'blocked role cannot query datasource' }
      }
      return true
    },
  })

  engine.load(dashboardConfig())

  await assert.rejects(
    () => createEditorAddon(engine).previewPanel('sales-table', {
      id: 'sales-table',
      type: 'table',
      title: 'Sales Preview',
      gridPos: { x: 0, y: 0, w: 12, h: 6 },
      dataRequests: [{
        id: 'main',
        uid: 'backend',
        type: 'backend',
        query: 'sales.preview',
        options: {},
        hide: false,
        permissions: [],
      }],
    }),
    /blocked role cannot query datasource/,
  )
  assert.equal(queryCalls, 0)
})

test('datasource plugin type must match data request type', async () => {
  let queryCalls = 0
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'sql',
    async queryData() {
      queryCalls += 1
      return { columns: [], rows: [] }
    },
  })
  const engine = createDashboardEngine({
    datasourcePlugins: [datasource],
    panels: [panel],
    variableTypes: [constantVariableType],
  })

  engine.load(dashboardConfig())
  await engine.refreshPanel('sales-table')

  assert.equal(queryCalls, 0)
  assert.equal(
    engine.getPanel('sales-table')?.error,
    'datasource "backend" type mismatch: expected "backend", got "sql"',
  )
})

test('panel data request ids must be unique within a panel', () => {
  const input = dashboardConfig()
  input.panels[0]!.dataRequests = [
    { id: 'main', uid: 'backend', type: 'backend' },
    { id: 'main', uid: 'backend', type: 'backend' },
  ]
  const engine = createDashboardEngine({
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async queryData() {
          return { columns: [], rows: [] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [constantVariableType],
  })

  assert.throws(() => engine.load(input), /panel data request ids must be unique within each panel/)
})

test('denied variable query does not resolve variable options', async () => {
  let resolveCalls = 0
  const queryVariableType = defineVariableType({
    id: 'query',
    name: 'Query',
    optionsSchema: {},
    async resolve() {
      resolveCalls += 1
      return [{ label: 'KR', value: 'KR' }]
    },
  })
  const input = dashboardConfig()
  input.variables = [
    {
      name: 'country',
      type: 'query',
      defaultValue: null,
      dataRequest: {
        id: 'options',
        uid: 'backend',
        type: 'backend',
        query: 'SELECT DISTINCT country FROM sales',
      },
      options: {},
    },
  ]
  const engine = createDashboardEngine({
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async queryData() {
          return { columns: [], rows: [] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [queryVariableType],
    authorize({ action }) {
      if (action === 'variable:query') {
        return { allowed: false, reason: 'cannot list variable options' }
      }
      return true
    },
  })

  engine.load(input)
  await engine.refreshVariables()

  assert.equal(resolveCalls, 0)
  assert.equal(engine.getVariable('country')?.error, 'cannot list variable options')
})
