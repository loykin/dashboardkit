import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createLayoutAddon,
  defineDatasource,
  definePanel,
} from '@loykin/dashboardkit'
import type { QueryResult } from '@loykin/dashboardkit'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })
const rowPanel = definePanel({ id: 'row', name: 'Row', optionsSchema: {} })

function wait(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('collapsed row excludes child panels from runtime instances', () => {
  const engine = createDashboardEngine({
    panels: [panel, rowPanel],
    datasourcePlugins: [],
    variableTypes: [],
  })

  engine.load({
    schemaVersion: 1,
    id: 'd',
    title: 'D',
    variables: [],
    panels: [
      {
        id: 'row-a',
        type: 'row',
        isRow: true,
        collapsed: true,
        gridPos: { x: 0, y: 0, w: 24, h: 1 },
      },
      {
        id: 'child-a',
        type: 'table',
        gridPos: { x: 0, y: 1, w: 12, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
      {
        id: 'row-b',
        type: 'row',
        isRow: true,
        gridPos: { x: 0, y: 10, w: 24, h: 1 },
      },
      {
        id: 'child-b',
        type: 'table',
        gridPos: { x: 0, y: 11, w: 12, h: 4 },
      },
    ],
  })

  assert.deepEqual(
    engine.getPanelInstances().map((instance) => instance.id),
    ['row-a', 'row-b', 'child-b'],
  )
  assert.equal(engine.getPanelInstance('row-a')?.isRow, true)
  assert.equal(engine.getPanelInstance('row-a')?.collapsed, true)
})

test('expanding a row triggers queries for newly visible child panels', async () => {
  let queryCalls = 0
  const datasource = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData() {
      queryCalls += 1
      return { columns: [], rows: [] }
    },
  })
  const engine = createDashboardEngine({
    panels: [panel, rowPanel],
    datasourcePlugins: [datasource],
    variableTypes: [],
  })

  engine.load({
    schemaVersion: 1,
    id: 'd',
    title: 'D',
    variables: [],
    panels: [
      {
        id: 'row-a',
        type: 'row',
        isRow: true,
        collapsed: true,
        gridPos: { x: 0, y: 0, w: 24, h: 1 },
      },
      {
        id: 'child-a',
        type: 'table',
        gridPos: { x: 0, y: 1, w: 12, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
    ],
  })
  await wait(50)

  assert.equal(queryCalls, 0)
  await createLayoutAddon(engine).toggleRow('row-a')

  assert.equal(engine.getPanelInstance('child-a')?.id, 'child-a')
  assert.equal(queryCalls, 1)
})

test('collapsing a row aborts in-flight requests for child panels', async () => {
  let started = false
  let aborted = false
  const datasource = defineDatasource({
    uid: 'ds',
    type: 'mock',
    queryData(_request, options) {
      started = true
      return new Promise<QueryResult>((_resolve, reject) => {
        if (options.signal?.aborted) {
          aborted = true
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
          return
        }
        options.signal?.addEventListener('abort', () => {
          aborted = true
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
        })
      })
    },
  })
  const engine = createDashboardEngine({
    panels: [panel, rowPanel],
    datasourcePlugins: [datasource],
    variableTypes: [],
  })

  engine.load({
    schemaVersion: 1,
    id: 'd',
    title: 'D',
    variables: [],
    panels: [
      {
        id: 'row-a',
        type: 'row',
        isRow: true,
        gridPos: { x: 0, y: 0, w: 24, h: 1 },
      },
      {
        id: 'child-a',
        type: 'table',
        gridPos: { x: 0, y: 1, w: 12, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
    ],
  })
  await wait(50)

  assert.equal(started, true)
  await createLayoutAddon(engine).toggleRow('row-a')

  assert.equal(aborted, true)
  assert.equal(engine.getPanelInstance('child-a'), undefined)
})
