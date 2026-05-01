import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  definePanel,
} from '@dashboard-engine/core'

const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {
    title: { type: 'string', label: 'Title', required: true, minLength: 2 },
    limit: { type: 'number', label: 'Limit', min: 1, max: 100, integer: true },
    showHeader: { type: 'boolean', label: 'Show header' },
    mode: {
      type: 'select',
      label: 'Mode',
      choices: [
        { label: 'Rows', value: 'rows' },
        { label: 'Columns', value: 'columns' },
      ],
    },
  },
})

test('validatePanelOptions validates options against panel option schema', () => {
  const engine = createDashboardEngine({
    panels: [tablePanel],
    datasourcePlugins: [],
    variableTypes: [],
  })

  assert.deepEqual(
    engine.validatePanelOptions('table', {
      title: 'Orders',
      limit: 50,
      showHeader: true,
      mode: 'rows',
    }),
    { valid: true, errors: [] },
  )

  assert.deepEqual(engine.validatePanelOptions('table', { limit: 200, mode: 'grid' }), {
    valid: false,
    errors: [
      { path: ['title'], message: 'required option is missing' },
      { path: ['limit'], message: 'must be <= 100' },
      { path: ['mode'], message: 'expected select' },
    ],
  })
})

test('validatePanelOptions can reject unknown options and custom validation failures', () => {
  const metricPanel = definePanel({
    id: 'metric',
    name: 'Metric',
    optionsSchema: {
      unit: {
        type: 'string',
        label: 'Unit',
        pattern: /^[a-z]+$/,
        validate(value) {
          return value === 'bad' ? 'unsupported unit' : null
        },
      },
      thresholds: {
        type: 'array',
        label: 'Thresholds',
        minItems: 1,
        maxItems: 2,
        items: {
          color: { type: 'color', label: 'Color', required: true },
          value: { type: 'number', label: 'Value', required: true },
        },
      },
    },
  })
  const engine = createDashboardEngine({
    panels: [metricPanel],
    datasourcePlugins: [],
    variableTypes: [],
  })

  assert.deepEqual(
    engine.validatePanelOptions(
      'metric',
      {
        unit: 'bad',
        extra: true,
        thresholds: [{ color: 'red' }, { color: 'yellow', value: 80 }, { color: 'green', value: 95 }],
      },
      { allowUnknown: false },
    ),
    {
      valid: false,
      errors: [
        { path: ['extra'], message: 'unknown option' },
        { path: ['unit'], message: 'unsupported unit' },
        { path: ['thresholds'], message: 'must contain at most 2 items' },
        { path: ['thresholds', '0', 'value'], message: 'required option is missing' },
      ],
    },
  )
})

test('validatePanelOptions reports missing panel type', () => {
  const engine = createDashboardEngine({
    panels: [tablePanel],
    datasourcePlugins: [],
    variableTypes: [],
  })

  assert.deepEqual(engine.validatePanelOptions('missing', {}), {
    valid: false,
    errors: [{ path: ['type'], message: 'panel type "missing" is not registered' }],
  })
})

test('validateDataRequest validates request input without executing queries', () => {
  const engine = createDashboardEngine({
    panels: [tablePanel],
    datasourcePlugins: [],
    variableTypes: [],
  })

  assert.deepEqual(
    engine.validateDataRequest({ uid: 'ds', type: 'mock' }),
    { valid: true, errors: [] },
  )

  const invalid = engine.validateDataRequest({ uid: '', type: '' })

  assert.equal(invalid.valid, false)
  assert.deepEqual(
    invalid.errors.map((error) => error.path),
    [['uid'], ['type']],
  )
})
