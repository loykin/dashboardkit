import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createMemoryDashboardStateStore,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@dashboard-engine/core'
import { createUrlDashboardStateStore } from '@dashboard-engine/core/url-state'
import type { DashboardInput, QueryOptions } from '@dashboard-engine/core'

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

function config(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'state-store-dashboard',
    title: 'State Store Dashboard',
    variables: [
      {
        name: 'country',
        type: 'constant',
        defaultValue: 'KR',
        options: {},
      },
    ],
    timeRange: { from: 'now-6h', to: 'now' },
    panels: [
      {
        id: 'sales-table',
        type: 'table',
        title: 'Sales',
        gridPos: { x: 0, y: 0, w: 12, h: 6 },
        dataRequests: [{ id: 'main', uid: 'backend', type: 'backend', options: {}, hide: false, permissions: [] }],
        options: {},
      },
    ],
  }
}

test('engine setters write to the canonical dashboard state store', () => {
  const stateStore = createMemoryDashboardStateStore()
  const engine = createDashboardEngine({
    stateStore,
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

  engine.load(config())
  engine.setVariable('country', 'US')
  engine.setTimeRange({ from: 'now-1h', to: 'now' })
  engine.setRefresh('30s')

  assert.deepEqual(stateStore.getSnapshot(), {
    variables: { country: 'US' },
    timeRange: { from: 'now-1h', to: 'now' },
    refresh: '30s',
  })
  assert.equal(engine.getVariable('country')?.value, 'US')
  assert.deepEqual(engine.getTimeRange(), { from: 'now-1h', to: 'now' })
  assert.equal(engine.getRefresh(), '30s')
})

test('external state store changes drive datasource query variables', async () => {
  let lastOptions: QueryOptions | undefined
  const stateStore = createMemoryDashboardStateStore({
    variables: { country: 'JP' },
    timeRange: { from: 'now-30m', to: 'now' },
  })
  const engine = createDashboardEngine({
    stateStore,
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async query(options) {
          lastOptions = options
          return {
            columns: [{ name: 'country', type: 'string' }],
            rows: [[options.variables['country']]],
          }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [constantVariableType],
  })

  engine.load(config())
  await engine.refreshPanel('sales-table')

  assert.deepEqual(lastOptions?.variables, { country: 'JP' })
  assert.deepEqual(lastOptions?.timeRange, { from: 'now-30m', to: 'now' })

  stateStore.setPatch({ variables: { country: 'US' } })
  await engine.refreshPanel('sales-table')

  assert.deepEqual(lastOptions?.variables, { country: 'US' })
})

test('unknown URL variables are preserved but never sent to datasource queries', async () => {
  // P1-2: 'JP' is not in the resolved options for country (constantVariableType returns defaultValue 'KR'),
  // so country falls back to 'KR'. The unknown key 'injected' is preserved in stateStore.
  let lastOptions: QueryOptions | undefined
  const stateStore = createMemoryDashboardStateStore({
    variables: {
      country: 'JP',
      injected: 'DROP TABLE sales',
    },
  })
  const engine = createDashboardEngine({
    stateStore,
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async query(options) {
          lastOptions = options
          return { columns: [], rows: [] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [constantVariableType],
  })

  engine.load(config())
  // Wait for background variable resolution to complete before asserting.
  // P1-2: 'JP' is not a valid option for country (options = ['KR']), so it falls back to 'KR'.
  await new Promise<void>((r) => setTimeout(r, 50))
  await engine.refreshPanel('sales-table')

  // 'injected' is preserved in stateStore (unknown key), 'country' is updated to 'KR' by P1-2
  assert.deepEqual(stateStore.getSnapshot().variables, {
    country: 'KR',
    injected: 'DROP TABLE sales',
  })
  // Only dashboard-config variables are sent to datasource; 'injected' is excluded
  assert.deepEqual(lastOptions?.variables, { country: 'KR' })
})

test('unknown variables injected after load do not reach datasource queries', async () => {
  let lastOptions: QueryOptions | undefined
  const stateStore = createMemoryDashboardStateStore({ variables: { country: 'KR' } })
  const engine = createDashboardEngine({
    stateStore,
    datasourcePlugins: [
      defineDatasource({
        uid: 'backend',
        type: 'backend',
        async query(options) {
          lastOptions = options
          return { columns: [], rows: [] }
        },
      }),
    ],
    panels: [panel],
    variableTypes: [constantVariableType],
  })

  engine.load(config())
  stateStore.setPatch({ variables: { injected: 'SELECT * FROM secrets' } })
  await engine.refreshPanel('sales-table')

  assert.deepEqual(stateStore.getSnapshot().variables, {
    country: 'KR',
    injected: 'SELECT * FROM secrets',
  })
  assert.deepEqual(lastOptions?.variables, { country: 'KR' })
})

test('loading a different dashboard ignores stale variables without removing them from canonical state', async () => {
  const stateStore = createMemoryDashboardStateStore({
    variables: { country: 'US', city: 'newyork' },
  })
  const engine = createDashboardEngine({
    stateStore,
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

  engine.load(config())

  assert.deepEqual(stateStore.getSnapshot().variables, { country: 'US', city: 'newyork' })
  assert.equal(engine.getVariable('city'), undefined)
})

test('url dashboard state store persists canonical state in query params', () => {
  let search = '?tab=dashboard&var-country=KR'
  const listeners = new Set<() => void>()
  const stateStore = createUrlDashboardStateStore({
    adapter: {
      getSearch: () => search,
      setSearch(nextSearch) {
        search = nextSearch
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })

  stateStore.setPatch({
    variables: {
      country: 'US',
      city: ['newyork', 'la'],
    },
    timeRange: { from: 'now-1h', to: 'now' },
    refresh: '30s',
  })

  assert.equal(
    search,
    '?tab=dashboard&var-country=US&var-city=newyork&var-city=la&from=now-1h&to=now&refresh=30s',
  )
  assert.deepEqual(stateStore.getSnapshot(), {
    variables: {
      country: 'US',
      city: ['newyork', 'la'],
    },
    timeRange: { from: 'now-1h', to: 'now' },
    refresh: '30s',
  })
})

test('url dashboard state store reacts to external URL changes', () => {
  let search = '?var-country=KR'
  const listeners = new Set<() => void>()
  const stateStore = createUrlDashboardStateStore({
    adapter: {
      getSearch: () => search,
      setSearch(nextSearch) {
        search = nextSearch
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })

  const snapshots: unknown[] = []
  stateStore.subscribe((snapshot) => snapshots.push(snapshot))

  search = '?var-country=JP&from=now-6h&to=now'
  listeners.forEach((listener) => listener())

  assert.deepEqual(snapshots, [
    {
      variables: { country: 'JP' },
      timeRange: { from: 'now-6h', to: 'now' },
    },
  ])
})
