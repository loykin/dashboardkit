import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@dashboard-engine/core'
import type {
  DashboardInput,
  PanelExpander,
  QueryOptions,
} from '@dashboard-engine/core'

const panel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
})

const listVariableType = defineVariableType({
  id: 'list',
  name: 'List',
  optionsSchema: {},
  async resolve(config) {
    const values = Array.isArray(config.defaultValue)
      ? config.defaultValue
      : config.defaultValue
        ? [config.defaultValue]
        : []
    return values.map((value) => ({ label: value, value }))
  },
})

function dashboardConfig(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'repeat-dashboard',
    title: 'Repeat Dashboard',
    layout: { cols: 24, rowHeight: 30 },
    variables: [
      {
        name: 'host',
        type: 'list',
        multi: true,
        defaultValue: ['api-1', 'api-2', 'api-3'],
        options: {},
      },
    ],
    panels: [
      {
        id: 'cpu',
        type: 'table',
        title: 'CPU $host',
        repeat: 'host',
        repeatDirection: 'h',
        gridPos: { x: 0, y: 0, w: 8, h: 6 },
        dataRequests: [{
          id: 'main',
          uid: 'backend',
          type: 'backend',
          query: 'cpu{host="$host"}',
        }],
        options: {},
      },
    ],
  }
}

test('repeat expands one panel config into runtime panel instances', async () => {
  const engine = createDashboardEngine({
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async query(options) {
          return { columns: [{ name: 'host', type: 'string' }], rows: [[options.variables['host']]] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [listVariableType],
  })

  engine.load(dashboardConfig())
  await engine.refreshVariables()

  assert.deepEqual(
    engine.getPanelInstances().map((instance) => ({
      id: instance.id,
      originId: instance.originId,
      value: instance.repeat?.value,
      gridPos: instance.gridPos,
    })),
    [
      { id: 'cpu', originId: 'cpu', value: 'api-1', gridPos: { x: 0, y: 0, w: 8, h: 6 } },
      { id: 'cpu__repeat__1', originId: 'cpu', value: 'api-2', gridPos: { x: 8, y: 0, w: 8, h: 6 } },
      { id: 'cpu__repeat__2', originId: 'cpu', value: 'api-3', gridPos: { x: 16, y: 0, w: 8, h: 6 } },
    ],
  )
})

test('refreshPanel executes a repeat instance with its scoped variable value', async () => {
  const queryOptions: QueryOptions[] = []
  const engine = createDashboardEngine({
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async query(options) {
          queryOptions.push(options)
          return { columns: [{ name: 'host', type: 'string' }], rows: [[options.variables['host']]] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [listVariableType],
  })

  engine.load(dashboardConfig())
  await engine.refreshVariables()

  queryOptions.length = 0
  await engine.refreshPanel('cpu__repeat__1')

  const lastOptions = queryOptions.at(-1)
  assert.equal(lastOptions?.panelId, 'cpu__repeat__1')
  assert.deepEqual(lastOptions?.variables, { host: 'api-2' })
  assert.deepEqual(engine.getPanel('cpu__repeat__1')?.rawData?.[0]?.rows, [['api-2']])
})

test('custom panel expanders can filter runtime instances after repeat expansion', async () => {
  const hideApi2: PanelExpander = {
    id: 'hide-api-2',
    expand(instances) {
      return instances.filter((instance) => instance.repeat?.value !== 'api-2')
    },
  }
  const engine = createDashboardEngine({
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async query(options) {
          return { columns: [{ name: 'host', type: 'string' }], rows: [[options.variables['host']]] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [listVariableType],
    panelExpanders: [hideApi2],
  })

  engine.load(dashboardConfig())
  await engine.refreshVariables()

  assert.deepEqual(engine.getPanelInstances().map((instance) => instance.id), ['cpu', 'cpu__repeat__2'])
  assert.equal(engine.getPanel('cpu__repeat__1'), undefined)
})
