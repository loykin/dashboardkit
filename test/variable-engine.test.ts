import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createMemoryDashboardStateStore,
  createVariableEngine,
  defineDatasource,
  defineVariableType,
} from '@loykin/dashboardkit'
import type { DashboardConfig } from '@loykin/dashboardkit'

const datasource = defineDatasource({
  uid: 'backend',
  type: 'backend',
  async query() {
    return { columns: [], rows: [] }
  },
})

const queryVariableType = defineVariableType({
  id: 'query',
  name: 'Query',
  optionsSchema: {},
  async resolve(config) {
    const values = Array.isArray(config.defaultValue)
      ? config.defaultValue
      : config.defaultValue
        ? [config.defaultValue]
        : ['KR']
    return values.map((value) => ({ label: value, value }))
  },
})

const dashboard: DashboardConfig = {
  schemaVersion: 1,
  id: 'vars',
  title: 'Variables',
  description: '',
  tags: [],
  variables: [],
  panels: [],
  layout: { cols: 24, rowHeight: 30 },
  timeRange: { from: 'now-6h', to: 'now' },
  refresh: '',
  links: [],
  permissions: [],
  annotations: [],
}

test('variable engine resolves variables without a dashboard engine', async () => {
  const stateStore = createMemoryDashboardStateStore()
  const varEngine = createVariableEngine({
    variableTypes: [queryVariableType],
    datasourcePlugins: [datasource],
    stateStore,
    getAuthContext: () => ({}),
    getDashboardConfig: () => dashboard,
  })

  varEngine.load([
    {
      name: 'country',
      type: 'query',
      defaultValue: 'KR',
      options: {},
      multi: false,
      permissions: [],
      sort: 'none' as const,
      hide: 'none' as const,
      includeAll: false,
      refreshOnTimeRangeChange: false,
    },
  ])

  const changed = await varEngine.refresh()

  assert.deepEqual(changed, ['country'])
  assert.deepEqual(stateStore.getSnapshot().variables, { country: 'KR' })
  assert.equal(varEngine.getState()['country']?.value, 'KR')
  assert.deepEqual(varEngine.getState()['country']?.options, [{ label: 'KR', value: 'KR' }])
})

test('variable engine falls back to default when stale canonical value is not in resolved options', async () => {
  // P1-2: stale value 'JP' is not in the resolved options ['KR'],
  // so the engine falls back to the configured defaultValue 'KR'.
  const stateStore = createMemoryDashboardStateStore({ variables: { country: 'JP' } })
  const varEngine = createVariableEngine({
    variableTypes: [queryVariableType],
    datasourcePlugins: [datasource],
    stateStore,
    getAuthContext: () => ({}),
    getDashboardConfig: () => dashboard,
  })

  varEngine.load([
    {
      name: 'country',
      type: 'query',
      defaultValue: 'KR',
      options: {},
      multi: false,
      permissions: [],
      sort: 'none' as const,
      hide: 'none' as const,
      includeAll: false,
      refreshOnTimeRangeChange: false,
    },
  ])

  const changed = await varEngine.refresh()

  assert.deepEqual(changed, ['country'])
  assert.deepEqual(stateStore.getSnapshot().variables, { country: 'KR' })
  assert.equal(varEngine.getState()['country']?.value, 'KR')
})
