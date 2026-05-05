import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createCrossFilterAddon,
  createDashboardEngine,
  defineDatasource,
  definePanel,
} from '@loykin/dashboardkit'
import type { DashboardInput, EngineEvent, DashboardDatasourceQueryContext } from '@loykin/dashboardkit'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

function makeConfig(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'cf-dashboard',
    title: 'Cross-filter Dashboard',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
      { id: 'p2', type: 'table', gridPos: { x: 6, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
    ],
  }
}

test('cross-filter variables are merged into panel query effective variables', async () => {
  const received: Record<string, DashboardDatasourceQueryContext> = {}

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData(_request, opts) {
      received[opts.panelId] = opts
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.setPanelSelection('p1', { country: 'US' })
  // wait for auto-refresh triggered by setPanelSelection
  await new Promise<void>((r) => setTimeout(r, 50))

  // Both panels should receive the cross-filter variable
  assert.equal(received['p1']?.variables['country'], 'US', 'p1 receives cross-filter')
  assert.equal(received['p2']?.variables['country'], 'US', 'p2 receives cross-filter')
})

test('clearing a panel selection removes its filter from other panels', async () => {
  const received: Record<string, DashboardDatasourceQueryContext> = {}

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData(_request, opts) {
      received[opts.panelId] = opts
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.setPanelSelection('p1', { country: 'US' })
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.clearPanelSelection('p1')
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(received['p2']?.variables['country'], undefined, 'country filter removed after clear')
})

test('clearAllPanelSelections removes all filters', async () => {
  const received: Record<string, DashboardDatasourceQueryContext> = {}

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData(_request, opts) {
      received[opts.panelId] = opts
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.setPanelSelection('p1', { country: 'US' })
  cf.setPanelSelection('p2', { region: 'west' })
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.clearAllPanelSelections()
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(received['p1']?.variables['country'], undefined, 'country cleared')
  assert.equal(received['p1']?.variables['region'], undefined, 'region cleared')
})

test('getPanelSelections returns current selection state', () => {
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())

  cf.setPanelSelection('p1', { country: 'US' })
  cf.setPanelSelection('p2', { region: 'west' })

  const selections = cf.getPanelSelections()
  assert.deepEqual(selections['p1'], { country: 'US' })
  assert.deepEqual(selections['p2'], { region: 'west' })

  cf.clearPanelSelection('p1')
  const after = cf.getPanelSelections()
  assert.equal(after['p1'], undefined, 'p1 selection removed')
  assert.deepEqual(after['p2'], { region: 'west' }, 'p2 selection preserved')
})

test('panel-selection-changed event is emitted', async () => {
  const events: EngineEvent[] = []
  const ds = defineDatasource({ uid: 'ds', type: 'mock', async queryData() { return { columns: [], rows: [] } } })
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())
  engine.subscribe((e) => events.push(e))

  cf.setPanelSelection('p1', { country: 'KR' })
  const setEvent = events.find((e) => e.type === 'panel-selection-changed' && e.panelId === 'p1')
  assert.ok(setEvent, 'panel-selection-changed emitted on set')
  assert.deepEqual((setEvent as Extract<EngineEvent, { type: 'panel-selection-changed' }>).selection, { country: 'KR' })

  events.length = 0
  cf.clearPanelSelection('p1')
  const clearEvent = events.find((e) => e.type === 'panel-selection-changed' && e.panelId === 'p1')
  assert.ok(clearEvent, 'panel-selection-changed emitted on clear')
  assert.equal((clearEvent as Extract<EngineEvent, { type: 'panel-selection-changed' }>).selection, null)
})

test('cross-filter is cleared on dashboard load', async () => {
  const received: Record<string, DashboardDatasourceQueryContext> = {}
  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData(_request, opts) {
      received[opts.panelId] = opts
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.setPanelSelection('p1', { country: 'US' })
  await new Promise<void>((r) => setTimeout(r, 50))

  // Reload dashboard — cross-filter should be cleared
  engine.load(makeConfig())
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(received['p1']?.variables['country'], undefined, 'cross-filter cleared after reload')
  assert.deepEqual(cf.getPanelSelections(), {}, 'selections empty after reload')
})

test('multiple panel selections are merged for all panels', async () => {
  const received: Record<string, DashboardDatasourceQueryContext> = {}
  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData(_request, opts) {
      received[opts.panelId] = opts
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  const cf = createCrossFilterAddon(engine)
  engine.load(makeConfig())
  await new Promise<void>((r) => setTimeout(r, 50))

  cf.setPanelSelection('p1', { country: 'US' })
  await new Promise<void>((r) => setTimeout(r, 50))
  cf.setPanelSelection('p2', { region: 'west' })
  await new Promise<void>((r) => setTimeout(r, 50))

  // Both filters should be merged into all panels' queries
  assert.equal(received['p1']?.variables['country'], 'US')
  assert.equal(received['p1']?.variables['region'], 'west')
  assert.equal(received['p2']?.variables['country'], 'US')
  assert.equal(received['p2']?.variables['region'], 'west')
})
