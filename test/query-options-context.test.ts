import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '../dist/index.js'
import type { DashboardInput, QueryOptions } from '../dist/index.js'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

const listType = defineVariableType({
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

function config(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'dash',
    title: 'Runtime Context',
    timeRange: { from: '2026-04-30T00:00:00.000Z', to: '2026-04-30T01:00:00.000Z' },
    variables: [
      { name: 'host', type: 'list', multi: true, defaultValue: ['api-1', 'api-2'], options: {} },
    ],
    panels: [
      {
        id: 'cpu',
        type: 'table',
        title: 'CPU',
        repeat: 'host',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        options: { unit: 'percent' },
        fieldConfig: { unit: 'percent' },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: 'cpu $host' }],
      },
    ],
  }
}

test('datasource query options include runtime panel context and builtins', async () => {
  const seen: QueryOptions[] = []
  const engine = createDashboardEngine({
    panels: [panel],
    variableTypes: [listType],
    datasourcePlugins: [
      defineDatasource({
        uid: 'ds',
        type: 'mock',
        async query(options) {
          seen.push(options)
          return { columns: [], rows: [] }
        },
      }),
    ],
  })

  engine.load(config())
  await engine.refreshVariables()

  seen.length = 0
  await engine.refreshPanel('cpu__repeat__1')
  const options = seen.at(-1)

  assert.equal(options?.panelId, 'cpu__repeat__1')
  assert.equal(options?.panel?.id, 'cpu')
  assert.deepEqual(options?.panelOptions, { unit: 'percent' })
  assert.equal(options?.panelInstance?.id, 'cpu__repeat__1')
  assert.equal(options?.panelInstance?.originId, 'cpu')
  assert.equal(options?.panelInstance?.repeat?.value, 'api-2')
  assert.deepEqual(options?.variables, { host: 'api-2' })
  assert.equal(options?.builtins?.['dashboard'], 'Runtime Context')
  assert.equal(options?.builtins?.['fromISO'], '2026-04-30T00:00:00.000Z')
})
