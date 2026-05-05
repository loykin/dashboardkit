import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createMemoryDashboardStateStore,
  createVariableEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import type { DashboardInput } from '@loykin/dashboardkit'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

test('variable readiness tracks idle, loading, success, error, and missing states', async () => {
  let enterSlow!: () => void
  let releaseSlow!: () => void
  const slowEntered = new Promise<void>((resolve) => { enterSlow = resolve })

  const slowType = defineVariableType({
    id: 'slow',
    name: 'Slow',
    optionsSchema: {},
    async resolve() {
      enterSlow()
      await new Promise<void>((resolve) => { releaseSlow = resolve })
      return [{ label: 'ready', value: 'ready' }]
    },
  })

  const errorType = defineVariableType({
    id: 'error',
    name: 'Error',
    optionsSchema: {},
    async resolve() {
      throw new Error('boom')
    },
  })

  const stateStore = createMemoryDashboardStateStore()
  const varEngine = createVariableEngine({
    variableTypes: [slowType, errorType],
    datasourcePlugins: [],
    stateStore,
    getAuthContext: () => ({}),
    getDashboardConfig: () => null,
  })

  varEngine.load([
    { name: 'slow', type: 'slow', defaultValue: null, multi: false, options: {}, permissions: [], sort: 'none' as const, hide: 'none' as const, includeAll: false, refreshOnTimeRangeChange: false },
    { name: 'bad', type: 'error', defaultValue: null, multi: false, options: {}, permissions: [], sort: 'none' as const, hide: 'none' as const, includeAll: false, refreshOnTimeRangeChange: false },
  ])

  assert.deepEqual(varEngine.getVariableReadiness(['slow']), {
    ready: false,
    waiting: ['slow'],
    errors: {},
  })

  const slowRefresh = varEngine.refreshOne('slow')
  await slowEntered
  assert.equal(varEngine.getState()['slow']?.status, 'loading')
  assert.deepEqual(varEngine.getVariableReadiness(['slow', 'missing']), {
    ready: false,
    waiting: ['slow', 'missing'],
    errors: {},
  })
  releaseSlow()
  await slowRefresh

  assert.equal(varEngine.getState()['slow']?.status, 'success')
  assert.deepEqual(varEngine.getVariableReadiness(['slow']), {
    ready: true,
    waiting: [],
    errors: {},
  })

  await varEngine.refreshOne('bad')
  assert.equal(varEngine.getState()['bad']?.status, 'error')
  assert.deepEqual(varEngine.getVariableReadiness(['bad']), {
    ready: false,
    waiting: [],
    errors: { bad: 'boom' },
  })
})

test('core exposes panel dependency and readiness for runtime instances', async () => {
  let releaseHost!: () => void
  let hostEntered!: () => void
  const hostReached = new Promise<void>((resolve) => { hostEntered = resolve })

  const hostType = defineVariableType({
    id: 'host',
    name: 'Host',
    optionsSchema: {},
    async resolve() {
      hostEntered()
      await new Promise<void>((resolve) => { releaseHost = resolve })
      return [{ label: 'api-1', value: 'api-1' }]
    },
  })

  const config: DashboardInput = {
    schemaVersion: 1,
    id: 'dash',
    title: 'Dash',
    variables: [
      { name: 'host', type: 'host', defaultValue: 'api-1', options: {} },
      { name: 'region', type: 'host', defaultValue: 'ap', options: {} },
    ],
    panels: [
      {
        id: 'cpu',
        type: 'table',
        title: 'CPU $host',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{
          id: 'main',
          uid: 'ds',
          type: 'mock',
          query: 'metric{host="$host"}',
          options: { region: '$region' },
        }],
      },
    ],
  }

  const engine = createDashboardEngine({
    panels: [panel],
    variableTypes: [hostType],
    datasourcePlugins: [
      defineDatasource({
        uid: 'ds',
        type: 'mock',
        async queryData() {
          return { columns: [], rows: [] }
        },
      }),
    ],
  })

  engine.load(config)
  await hostReached

  const deps = engine.getPanelDependencies('cpu')
  assert.deepEqual(deps, {
    directVariables: ['host', 'region'],
    requiredVariables: ['host', 'region'],
  })
  assert.deepEqual(engine.getPanelReadiness('cpu'), {
    ready: false,
    waitingVariables: ['host', 'region'],
    variableErrors: {},
  })

  releaseHost()
})
