import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDefaultDashboardState,
  DashboardConfigSchema,
  mergeDashboardStateSnapshots,
  resolveDashboardInitialState,
} from '../dist/index.js'

test('initial state resolver applies URL over saved over defaults', () => {
  const config = DashboardConfigSchema.parse({
    schemaVersion: 1,
    id: 'dash',
    title: 'Dash',
    variables: [
      { name: 'country', type: 'constant', defaultValue: 'KR', options: {} },
      { name: 'city', type: 'constant', defaultValue: 'Seoul', options: {} },
    ],
    timeRange: { from: 'now-1h', to: 'now' },
    refresh: '30s',
    panels: [],
  })

  const initial = resolveDashboardInitialState({
    defaults: buildDefaultDashboardState(config),
    saved: {
      variables: { country: 'JP', unknown_saved: 'keep' },
      timeRange: { from: 'now-6h', to: 'now' },
      refresh: '1m',
    },
    url: {
      variables: { country: 'US', unknown_url: 'keep' },
      refresh: '5s',
    },
  })

  assert.deepEqual(initial.variables, {
    country: 'US',
    city: 'Seoul',
    unknown_saved: 'keep',
    unknown_url: 'keep',
  })
  assert.deepEqual(initial.timeRange, { from: 'now-6h', to: 'now' })
  assert.equal(initial.refresh, '5s')
})

test('mergeDashboardStateSnapshots shallow merges variables without pruning unknown keys', () => {
  const merged = mergeDashboardStateSnapshots(
    { variables: { a: 'default', untouched: 'x' }, refresh: '30s' },
    { variables: { a: 'saved', savedOnly: 'y' } },
    { variables: { urlOnly: 'z' } },
  )

  assert.deepEqual(merged.variables, {
    a: 'saved',
    untouched: 'x',
    savedOnly: 'y',
    urlOnly: 'z',
  })
  assert.equal(merged.refresh, '30s')
})
