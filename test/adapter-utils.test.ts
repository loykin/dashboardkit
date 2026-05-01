import test from 'node:test'
import assert from 'node:assert/strict'

import {
  constantVariableType,
  customVariableType,
  intervalVariableType,
  interpolateVariables,
  parseRelativeTime,
  parseTimeRange,
} from '@dashboard-engine/core'

const variableConfig = {
  name: 'v',
  type: 'custom',
  defaultValue: 'default',
  multi: false,
  options: {},
  permissions: [],
  sort: 'none' as const,
  hide: 'none' as const,
  includeAll: false,
}

const resolveContext = {
  datasourcePlugins: {},
  builtins: {},
  variables: {},
  dashboard: { id: 'dash', title: 'Dash' },
}

test('interpolateVariables replaces plain and braced variables with multi-value joining', () => {
  assert.equal(
    interpolateVariables('host=$host region=${region}', {
      host: ['api-1', 'api-2'],
      region: 'ap',
    }),
    'host=api-1,api-2 region=ap',
  )
})

test('parseTimeRange resolves relative time expressions against a fixed now', () => {
  const now = new Date('2026-04-30T12:34:56.789Z')
  const parsed = parseTimeRange({ from: 'now-6h', to: 'now' }, now)

  assert.equal(parsed.from.toISOString(), '2026-04-30T06:34:56.789Z')
  assert.equal(parsed.to.toISOString(), '2026-04-30T12:34:56.789Z')
})

test('parseRelativeTime supports rounding', () => {
  const now = new Date('2026-04-30T12:34:56.789Z')
  assert.equal(parseRelativeTime('now/h', now).toISOString(), '2026-04-30T12:00:00.000Z')
})

test('builtin variable types return variable options', async () => {
  assert.deepEqual(
    await constantVariableType.resolve(
      { ...variableConfig, type: 'constant', defaultValue: 'prod' },
      {},
      resolveContext,
    ),
    [{ label: 'prod', value: 'prod' }],
  )

  assert.deepEqual(
    await customVariableType.resolve(variableConfig, { values: ['a', 'b'] }, resolveContext),
    [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }],
  )

  assert.deepEqual(
    await intervalVariableType.resolve(
      { ...variableConfig, type: 'interval', defaultValue: null },
      {},
      resolveContext,
    ),
    [
      { label: '1m', value: '1m' },
      { label: '5m', value: '5m' },
      { label: '15m', value: '15m' },
      { label: '1h', value: '1h' },
      { label: '6h', value: '6h' },
      { label: '1d', value: '1d' },
    ],
  )
})
