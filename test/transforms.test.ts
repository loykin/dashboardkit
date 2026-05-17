import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyTransforms,
  queryResultToTableRows,
  tableRowsToQueryResult,
} from '@loykin/dashboardkit'

test('joinByField outer joins table results by key field', () => {
  const [joined] = applyTransforms([
    tableRowsToQueryResult({
      columns: [{ name: 'country', type: 'string' }, { name: 'users', type: 'number' }],
      rows: [
        ['KR', 1000],
        ['US', 800],
      ],
    }),
    tableRowsToQueryResult({
      columns: [{ name: 'country', type: 'string' }, { name: 'revenue', type: 'number' }],
      rows: [
        ['KR', 50000],
        ['JP', 30000],
      ],
    }),
  ], [{ type: 'joinByField', field: 'country', mode: 'outer' }])

  const table = queryResultToTableRows(joined!)
  assert.deepEqual(table.columns.map((column) => column.name), ['country', 'users', 'revenue'])
  assert.deepEqual(table.rows, [
    ['KR', 1000, 50000],
    ['US', 800, null],
    ['JP', null, 30000],
  ])
})

test('joinByField supports inner and left join modes', () => {
  const results = [
    tableRowsToQueryResult({
      columns: [{ name: 'country', type: 'string' }, { name: 'users', type: 'number' }],
      rows: [
        ['KR', 1000],
        ['US', 800],
      ],
    }),
    tableRowsToQueryResult({
      columns: [{ name: 'country', type: 'string' }, { name: 'revenue', type: 'number' }],
      rows: [
        ['KR', 50000],
        ['JP', 30000],
      ],
    }),
  ]

  const [inner] = applyTransforms(results, [{ type: 'joinByField', field: 'country', mode: 'inner' }])
  const [left] = applyTransforms(results, [{ type: 'joinByField', field: 'country', mode: 'left' }])

  assert.deepEqual(queryResultToTableRows(inner!).rows, [['KR', 1000, 50000]])
  assert.deepEqual(queryResultToTableRows(left!).rows, [
    ['KR', 1000, 50000],
    ['US', 800, null],
  ])
})

test('joinByField preserves duplicate key combinations and disambiguates duplicate columns', () => {
  const [joined] = applyTransforms([
    tableRowsToQueryResult({
      columns: [{ name: 'host', type: 'string' }, { name: 'value', type: 'number' }],
      rows: [
        ['api-1', 1],
        ['api-1', 2],
      ],
    }),
    tableRowsToQueryResult({
      columns: [{ name: 'host', type: 'string' }, { name: 'value', type: 'number' }],
      rows: [
        ['api-1', 10],
        ['api-1', 20],
      ],
    }),
  ], [{ type: 'joinByField', field: 'host', mode: 'inner' }])

  const table = queryResultToTableRows(joined!)
  assert.deepEqual(table.columns.map((column) => column.name), ['host', 'value', 'value 2'])
  assert.deepEqual(table.rows, [
    ['api-1', 1, 10],
    ['api-1', 1, 20],
    ['api-1', 2, 10],
    ['api-1', 2, 20],
  ])
})

test('joinByField leaves results unchanged when a result lacks the key field', () => {
  const results = [
    tableRowsToQueryResult({
      columns: [{ name: 'country', type: 'string' }, { name: 'users', type: 'number' }],
      rows: [['KR', 1000]],
    }),
    tableRowsToQueryResult({
      columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }],
      rows: [['KR', 50000]],
    }),
  ]

  assert.equal(applyTransforms(results, [{ type: 'joinByField', field: 'country' }]), results)
})
