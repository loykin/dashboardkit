import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createMemoryDashboardStateStore,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import type { DashboardConfig, DashboardInput, EngineEvent, DashboardDatasourceQueryContext } from '@loykin/dashboardkit'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

function waitForAsyncLoad(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30))
}

function baseConfig(): DashboardInput {
  return {
    schemaVersion: 1,
    id: 'd',
    title: 'Dashboard',
    variables: [],
    panels: [
      {
        id: 'p1',
        type: 'table',
        title: 'Panel 1',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
    ],
  }
}

function makeDs(onQuery?: (opts: DashboardDatasourceQueryContext) => void) {
  return defineDatasource({
    uid: 'ds',
    type: 'mock',
    async queryData(_request, opts) {
      onQuery?.(opts)
      return { columns: [], rows: [] }
    },
  })
}

const constantVariableType = defineVariableType({
  id: 'constant',
  name: 'Constant',
  optionsSchema: {},
  async resolve(config, options) {
    const values = String((options as Record<string, unknown>)['values'] ?? config.defaultValue ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    return values.map((value) => ({ label: value, value }))
  },
})

test('addPanel updates saveable config and creates runtime instances', async () => {
  const queriedPanels: string[] = []
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs((opts) => queriedPanels.push(opts.panelId))],
    variableTypes: [],
  })

  engine.load(baseConfig())
  await waitForAsyncLoad()
  queriedPanels.length = 0

  await engine.addPanel({
    id: 'p2',
    type: 'table',
    title: 'Panel 2',
    gridPos: { x: 6, y: 0, w: 6, h: 4 },
    dataRequests: [{ uid: 'ds', type: 'mock' }],
  })

  assert.equal(engine.getConfig()?.panels.some((p) => p.id === 'p2'), true)
  assert.equal(engine.getPanelInstance('p2')?.config.title, 'Panel 2')
  assert.deepEqual(queriedPanels, ['p2'])
})

test('addPanel rejects duplicate origin panel ids', async () => {
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs()],
    variableTypes: [],
  })

  engine.load(baseConfig())
  await waitForAsyncLoad()

  await assert.rejects(
    () => engine.addPanel({
      id: 'p1',
      type: 'table',
      gridPos: { x: 0, y: 4, w: 6, h: 4 },
    }),
    (err: Error) => err.name === 'PanelValidationError',
  )
})

test('removePanel updates config and removes runtime instances without refreshing unrelated panels', async () => {
  const queriedPanels: string[] = []
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs((opts) => queriedPanels.push(opts.panelId))],
    variableTypes: [],
  })

  engine.load({
    ...baseConfig(),
    panels: [
      ...baseConfig().panels,
      {
        id: 'p2',
        type: 'table',
        title: 'Panel 2',
        gridPos: { x: 6, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
    ],
  })
  await waitForAsyncLoad()
  queriedPanels.length = 0

  await engine.removePanel('p2')

  assert.equal(engine.getConfig()?.panels.some((p) => p.id === 'p2'), false)
  assert.equal(engine.getPanelInstance('p2'), undefined)
  assert.deepEqual(queriedPanels, [])
})

test('removePanel rejects repeat runtime instance ids', async () => {
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs()],
    variableTypes: [constantVariableType],
  })

  engine.load({
    ...baseConfig(),
    variables: [{
      name: 'host',
      type: 'constant',
      multi: true,
      defaultValue: ['a', 'b'],
      options: { values: 'a,b' },
    }],
    panels: [
      {
        id: 'cpu',
        type: 'table',
        repeat: 'host',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
    ],
  })
  await waitForAsyncLoad()

  assert.ok(engine.getPanelInstance('cpu__repeat__1'))
  await assert.rejects(
    () => engine.removePanel('cpu__repeat__1'),
    (err: Error) => err.name === 'PanelNotFoundError',
  )
})

test('variable CRUD updates config, runtime state, and preserves unknown state keys', async () => {
  const stateStore = createMemoryDashboardStateStore({
    variables: { authToken: 'external-token' },
  })
  const queriedVariables: Array<Record<string, string | string[]>> = []
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs((opts) => queriedVariables.push(opts.variables))],
    variableTypes: [constantVariableType],
    stateStore,
  })

  engine.load({
    ...baseConfig(),
    panels: [{
      id: 'p1',
      type: 'table',
      title: '$country',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: '$country' }],
    }],
  })
  await waitForAsyncLoad()
  queriedVariables.length = 0

  await engine.addVariable({
    name: 'country',
    type: 'constant',
    defaultValue: 'KR',
    options: { values: 'KR,US' },
  })

  assert.equal(engine.getConfig()?.variables.some((v) => v.name === 'country'), true)
  assert.equal(engine.getVariable('country')?.value, 'KR')
  assert.equal(stateStore.getSnapshot().variables.authToken, 'external-token')
  assert.equal(queriedVariables.at(-1)?.country, 'KR')

  await engine.updateVariable('country', { defaultValue: 'US', options: { values: 'US' } })

  assert.equal(engine.getVariable('country')?.value, 'US')
  assert.equal(engine.getConfig()?.variables.find((v) => v.name === 'country')?.defaultValue, 'US')

  await engine.removeVariable('country')

  assert.equal(engine.getConfig()?.variables.some((v) => v.name === 'country'), false)
  assert.equal(engine.getVariable('country'), undefined)
  assert.equal(stateStore.getSnapshot().variables.authToken, 'external-token')
})

test('updateVariable rejects renames and unknown variables', async () => {
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs()],
    variableTypes: [constantVariableType],
  })

  engine.load({
    ...baseConfig(),
    variables: [{ name: 'country', type: 'constant', options: { values: 'KR' } }],
  })
  await waitForAsyncLoad()

  await assert.rejects(
    () => engine.updateVariable('country', { name: 'region' }),
    (err: Error) => err.name === 'VariableValidationError',
  )
  await assert.rejects(
    () => engine.updateVariable('missing', { label: 'Missing' }),
    (err: Error) => err.name === 'VariableNotFoundError',
  )
})

test('updateDashboard updates metadata and rejects structural fields', async () => {
  const events: DashboardConfig[] = []
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [makeDs()],
    variableTypes: [],
  })
  engine.subscribe((event: EngineEvent) => {
    if (event.type === 'config-changed') events.push(event.config)
  })

  engine.load(baseConfig())
  await waitForAsyncLoad()

  await engine.updateDashboard({
    title: 'Updated Dashboard',
    description: 'Edited',
    tags: ['ops'],
    layout: { cols: 12, rowHeight: 24 },
  })

  assert.equal(engine.getConfig()?.title, 'Updated Dashboard')
  assert.equal(engine.getConfig()?.layout.cols, 12)
  assert.equal(events.at(-1)?.title, 'Updated Dashboard')

  const invalidPanelsPatch = JSON.parse('{"panels":[]}')
  const invalidVariablesPatch = JSON.parse('{"variables":[]}')

  await assert.rejects(
    () => engine.updateDashboard(invalidPanelsPatch),
    (err: Error) => err.name === 'DashboardValidationError',
  )
  await assert.rejects(
    () => engine.updateDashboard(invalidVariablesPatch),
    (err: Error) => err.name === 'DashboardValidationError',
  )
})
