import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '../dist/index.js'
import type {
  DashboardInput,
  QueryOptions,
} from '../dist/index.js'

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
  let lastOptions: QueryOptions | undefined
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'backend',
    async query(options) {
      queryCalls += 1
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
  assert.equal(lastOptions?.dataRequest.uid, 'backend')
  assert.equal(lastOptions?.dataRequest.type, 'backend')
  assert.equal(lastOptions?.query, 'sales.list')
  assert.deepEqual(lastOptions?.requestOptions, { limit: 100 })
  assert.deepEqual(lastOptions?.variables, { country: 'KR' })
  assert.equal(lastOptions?.authContext?.subject?.id, 'viewer-1')
})

test('denied datasource query does not call the datasource plugin', async () => {
  let queryCalls = 0
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'backend',
    async query() {
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

test('datasource plugin type must match data request type', async () => {
  let queryCalls = 0
  const datasource = defineDatasource({
    uid: 'backend',
    type: 'sql',
    async query() {
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
        async query() {
          return { columns: [], rows: [] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [constantVariableType],
  })

  assert.throws(() => engine.load(input), /panel data request ids must be unique within each panel/)
})
