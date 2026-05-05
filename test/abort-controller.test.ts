import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import type { DashboardInput } from '@loykin/dashboardkit'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

const constantVariableType = defineVariableType({
  id: 'constant',
  name: 'Constant',
  optionsSchema: {},
  async resolve(config) {
    const value = Array.isArray(config.defaultValue) ? config.defaultValue[0] : config.defaultValue
    return value ? [{ label: value, value }] : []
  },
})

function makeConfig(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'dash',
    title: 'Dash',
    variables: [{ name: 'env', type: 'constant', defaultValue: 'prod', options: {} }],
    panels: [
      {
        id: 'p1',
        type: 'table',
        title: 'Panel',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'r1', uid: 'ds1', type: 'mock', query: 'SELECT 1' }],
      },
    ],
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('datasource receives AbortSignal on each query call', async () => {
  const signals: (AbortSignal | undefined)[] = []
  let queryEntered!: () => void
  const queryReached = new Promise<void>((r) => { queryEntered = r })

  const ds = defineDatasource({
    uid: 'ds1',
    type: 'mock',
    async queryData(_request, opts) {
      signals.push(opts.signal)
      queryEntered()
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [ds],
    variableTypes: [constantVariableType],
  })

  engine.load(makeConfig())
  await queryReached

  assert.ok(signals.length > 0, 'query should have been called')
  assert.ok(signals[signals.length - 1] instanceof AbortSignal, 'signal should be an AbortSignal')
})

test('previous panel request is aborted when a newer request starts', async () => {
  let resolveFirst!: () => void
  let firstSignal: AbortSignal | undefined
  let queryCount = 0
  let initialQueryEntered!: () => void
  let firstQueryEntered!: () => void
  const initialQueryReached = new Promise<void>((r) => { initialQueryEntered = r })
  const firstQueryReached = new Promise<void>((r) => { firstQueryEntered = r })

  const ds = defineDatasource({
    uid: 'ds1',
    type: 'mock',
    async queryData(_request, opts) {
      queryCount += 1
      if (queryCount === 1) {
        initialQueryEntered()
        return { columns: [{ name: 'value', type: 'string' }], rows: [['initial']] }
      }
      if (queryCount === 2) {
        firstSignal = opts.signal
        firstQueryEntered()
        await new Promise<void>((resolve) => { resolveFirst = resolve })
        return { columns: [{ name: 'value', type: 'string' }], rows: [['old']] }
      }
      return { columns: [{ name: 'value', type: 'string' }], rows: [['new']] }
    },
  })

  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [ds],
    variableTypes: [constantVariableType],
  })

  engine.load(makeConfig())
  await initialQueryReached
  await nextTick()

  const first = engine.refreshPanel('p1')
  // Wait until the first request has actually entered queryData (and set firstSignal)
  await firstQueryReached
  // Now start the second request — this aborts the first controller
  const second = engine.refreshPanel('p1')

  assert.ok(firstSignal?.aborted, 'first request signal should be aborted')
  resolveFirst()

  await Promise.allSettled([first, second])

  const state = engine.getPanel('p1')
  assert.equal(state?.error, null)
  assert.deepEqual(state?.rawData?.[0]?.rows, [['new']])
})

test('load() aborts pending panel requests before replacing dashboard state', async () => {
  let capturedSignal: AbortSignal | undefined
  let releaseInitial!: () => void
  let queryCount = 0
  let initialQueryEntered!: () => void
  const initialQueryReached = new Promise<void>((r) => { initialQueryEntered = r })

  const ds = defineDatasource({
    uid: 'ds1',
    type: 'mock',
    async queryData(_request, opts) {
      queryCount += 1
      capturedSignal = opts.signal
      if (queryCount > 1) return { columns: [], rows: [] }
      initialQueryEntered()
      await new Promise<void>((resolve) => { releaseInitial = resolve })
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [ds],
    variableTypes: [constantVariableType],
  })

  engine.load(makeConfig())
  await initialQueryReached

  const previousSignal = capturedSignal

  // Reload — should abort all existing panel controllers
  engine.load(makeConfig())

  assert.ok(previousSignal?.aborted, 'load() should abort previous panel controllers')
  releaseInitial()
})
