import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createDatasourceRegistry,
  DatasourceNotFoundError,
  DatasourceTypeMismatchError,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import type { DashboardInput } from '@loykin/dashboardkit'

const datasource = defineDatasource({
  uid: 'backend',
  type: 'mock',
  async query() {
    return { columns: [], rows: [] }
  },
})

const datasourceWithCapabilities = defineDatasource({
  uid: 'backend-with-capabilities',
  type: 'mock',
  optionsSchema: {},
  async query() {
    return { columns: [], rows: [] }
  },
  variable: {
    async metricFindQuery() {
      return [{ label: 'a', value: 'a' }]
    },
  },
  editor: {
    querySchema: {},
    validateQuery() {
      return { valid: true }
    },
  },
  connector: {
    configSchema: {},
    healthCheck: async () => ({ ok: true }),
  },
  schema: {
    async listNamespaces() {
      return [{ id: 'default', name: 'Default' }]
    },
  },
})

test('datasource registry looks up plugins and validates request type', () => {
  const registry = createDatasourceRegistry([datasource])

  assert.equal(registry.has('backend'), true)
  assert.equal(registry.get('backend'), datasource)
  assert.deepEqual(registry.list(), [datasource])
  assert.equal(registry.toRecord()['backend'], datasource)
  assert.equal(
    registry.getForRequest({ id: 'main', uid: 'backend', type: 'mock', options: {}, hide: false, permissions: [], staleWhileRevalidate: false }),
    datasource,
  )
})

test('datasource registry throws standard errors for missing and mismatched datasources', () => {
  const registry = createDatasourceRegistry([datasource])

  assert.throws(
    () => registry.getForRequest({ id: 'main', uid: 'missing', type: 'mock', options: {}, hide: false, permissions: [], staleWhileRevalidate: false }),
    DatasourceNotFoundError,
  )
  assert.throws(
    () => registry.getForRequest({ id: 'main', uid: 'backend', type: 'sql', options: {}, hide: false, permissions: [], staleWhileRevalidate: false }),
    DatasourceTypeMismatchError,
  )
})

test('datasource registry exposes optional plugin capabilities', () => {
  const registry = createDatasourceRegistry([datasource, datasourceWithCapabilities])

  assert.equal(
    registry.getVariableSupport('backend-with-capabilities'),
    datasourceWithCapabilities.variable,
  )
  assert.equal(
    registry.getEditorSupport('backend-with-capabilities'),
    datasourceWithCapabilities.editor,
  )
  assert.equal(
    registry.getConnectorSupport('backend-with-capabilities'),
    datasourceWithCapabilities.connector,
  )
  assert.equal(
    registry.getConnectorByType('mock'),
    datasourceWithCapabilities.connector,
  )
  assert.equal(
    registry.getSchemaSupport('backend-with-capabilities'),
    datasourceWithCapabilities.schema,
  )
  assert.equal(registry.getVariableSupport('backend'), undefined)
  assert.equal(registry.getEditorSupport('missing'), undefined)
})

test('datasource registry returns undefined connector when no plugin of that type has one', () => {
  const registry = createDatasourceRegistry([datasource])

  assert.equal(registry.getConnectorByType('mock'), undefined)
  assert.equal(registry.getConnectorByType('missing'), undefined)
})

test('engine panel query uses datasource registry validation', async () => {
  const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })
  const input: DashboardInput = {
    schemaVersion: 1,
    id: 'dash',
    title: 'Dash',
    variables: [],
    panels: [
      {
        id: 'p1',
        type: 'table',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'missing', type: 'mock' }],
      },
    ],
  }
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [datasource],
    variableTypes: [],
  })

  engine.load(input)
  await engine.refreshPanel('p1')

  assert.equal(engine.getPanel('p1')?.error, 'datasource "missing" not registered in engine')
})

test('variable query uses datasource registry validation', async () => {
  const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })
  const queryVariable = defineVariableType({
    id: 'query',
    name: 'Query',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'x', value: 'x' }]
    },
  })
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [datasource],
    variableTypes: [queryVariable],
  })

  engine.load({
    schemaVersion: 1,
    id: 'dash',
    title: 'Dash',
    variables: [{
      name: 'v',
      type: 'query',
      defaultValue: null,
      dataRequest: { id: 'options', uid: 'backend', type: 'sql' },
      options: {},
    }],
    panels: [],
  })
  await engine.refreshVariables()

  assert.equal(
    engine.getVariable('v')?.error,
    'datasource "backend" type mismatch: expected "sql", got "mock"',
  )
})
