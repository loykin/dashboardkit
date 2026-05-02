import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDashboardEngine,
  createEditorAddon,
  defineDatasource,
  definePanel,
  defineVariableType,
  createMemoryDashboardStateStore,
} from '@loykin/dashboardkit'
import type { DashboardInput, QueryOptions, QueryResult } from '@loykin/dashboardkit'

const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

function makeDs(uid: string, onQuery?: (opts: QueryOptions) => void) {
  return defineDatasource({
    uid,
    type: 'mock',
    async query(opts) {
      onQuery?.(opts)
      return { columns: [], rows: [] }
    },
  })
}

// ─── P0-1: exact variable reference detection ──────────────────────────────────

test('$env matches variable env but not $environment or $envId', async () => {
  const envDs = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query() {
      return { columns: [], rows: [] }
    },
  })

  const config: DashboardInput = {
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [
      { name: 'env', type: 'constant', options: { values: 'prod' } },
      { name: 'environment', type: 'constant', options: { values: 'staging' } },
    ],
    panels: [
      {
        id: 'p1', type: 'table',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        // references $env only
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: 'SELECT $env' }],
      },
    ],
  }

  const constantType = defineVariableType({
    id: 'constant',
    name: 'Constant',
    optionsSchema: {},
    async resolve(config, options) {
      const vals = String((options as Record<string, unknown>)['values'] ?? '').split(',')
      return vals.map((v) => ({ label: v.trim(), value: v.trim() }))
    },
  })

  const engine2 = createDashboardEngine({ panels: [panel], datasourcePlugins: [envDs], variableTypes: [constantType] })
  engine2.load(config)
  await new Promise<void>((r) => setTimeout(r, 50))

  // change $env — only p1 should refresh (it references $env)
  // change $environment — p1 should NOT refresh (it references $env, not $environment)
  // This test verifies collectPanelRefs uses exact matching via parseRefs
  const deps = engine2.getPanelDependencies('p1')
  assert.ok(deps?.directVariables.includes('env'), 'env should be in direct variables')
  assert.ok(!deps?.directVariables.includes('environment'), 'environment should NOT be in direct variables')
})

// ─── P0-2: transitive variable refresh cascade ─────────────────────────────────

test('A -> B -> C: changing A cascades to refresh B and C', async () => {
  const resolveOrder: string[] = []
  let callCount = 0

  // Each resolve call returns a unique value so the cascade detects changes
  const chainType = defineVariableType({
    id: 'chain',
    name: 'Chain',
    optionsSchema: {},
    async resolve(config) {
      resolveOrder.push(config.name)
      callCount++
      return [{ label: `${config.name}-${callCount}`, value: `${config.name}-${callCount}` }]
    },
  })

  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [chainType] })

  // A is independent, B depends on A's query, C depends on B's query
  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [
      { name: 'varA', type: 'chain' },
      { name: 'varB', type: 'chain', dataRequest: { id: 'r1', uid: 'ds', type: 'mock', query: '$varA' } },
      { name: 'varC', type: 'chain', dataRequest: { id: 'r2', uid: 'ds', type: 'mock', query: '$varB' } },
    ],
    panels: [],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  resolveOrder.length = 0

  // refreshVariable on varA resolves a new value → cascade to B and C
  const changed = await engine.refreshVariable('varA')
  assert.ok(changed, 'refreshVariable should return true when value changed')
  assert.ok(resolveOrder.includes('varB'), 'B should be refreshed after A changes')
  assert.ok(resolveOrder.includes('varC'), 'C should be refreshed after B changes')
  assert.ok(resolveOrder.indexOf('varB') < resolveOrder.indexOf('varC'), 'B must be refreshed before C')
})

test('variable with two changed parents refreshes once', async () => {
  let resolveCount = 0

  const countType = defineVariableType({
    id: 'count',
    name: 'Count',
    optionsSchema: {},
    async resolve() {
      resolveCount++
      return [{ label: 'x', value: 'x' }]
    },
  })

  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [countType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [
      { name: 'varA', type: 'count' },
      { name: 'varB', type: 'count' },
      // varC depends on both A and B
      { name: 'varC', type: 'count', dataRequest: { id: 'r1', uid: 'ds', type: 'mock', query: '$varA $varB' } },
    ],
    panels: [],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  resolveCount = 0

  // downstream of both A and B changing — C should only run once
  await engine.refreshVariable('varA')
  await engine.refreshVariable('varB')
  // Each call cascades to C, but within one call C is visited once
  assert.ok(resolveCount <= 3, 'varC should not be resolved more than once per refreshVariable call')
})

// ─── P0-3: narrow cache invalidation ──────────────────────────────────────────

test('refreshing panel A does not evict panel B cache', async () => {
  const queryCounts: Record<string, number> = { p1: 0, p2: 0 }

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      queryCounts[opts.panelId] = (queryCounts[opts.panelId] ?? 0) + 1
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
      { id: 'p2', type: 'table', gridPos: { x: 6, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
    ],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  const afterLoad = { ...queryCounts }

  // Refresh p1 only — p2 should serve from cache (no additional query)
  await engine.refreshPanel('p1')
  assert.equal(queryCounts['p2'], afterLoad['p2'], 'p2 should not re-query when p1 is refreshed')
  assert.equal(queryCounts['p1'], (afterLoad['p1'] ?? 0) + 1, 'p1 should re-query after refresh')
})

// ─── P1-1: refreshVariable public API ─────────────────────────────────────────

test('refreshVariable refreshes one variable without touching unrelated ones', async () => {
  const resolvedNames: string[] = []

  const trackType = defineVariableType({
    id: 'track',
    name: 'Track',
    optionsSchema: {},
    async resolve(config) {
      resolvedNames.push(config.name)
      return [{ label: config.name, value: config.name }]
    },
  })

  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [trackType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [
      { name: 'varA', type: 'track' },
      { name: 'varB', type: 'track' },
    ],
    panels: [],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  resolvedNames.length = 0

  await engine.refreshVariable('varA')
  assert.ok(resolvedNames.includes('varA'), 'varA should be refreshed')
  assert.ok(!resolvedNames.includes('varB'), 'varB should not be refreshed')
})

// ─── P1-2: value validation after options refresh ──────────────────────────────

test('invalid current value falls back to first option after options refresh', async () => {
  const optionsToReturn = ['alpha', 'beta']

  const dynamicType = defineVariableType({
    id: 'dynamic',
    name: 'Dynamic',
    optionsSchema: {},
    async resolve() {
      return optionsToReturn.map((v) => ({ label: v, value: v }))
    },
  })

  const stateStore = createMemoryDashboardStateStore({ variables: { env: 'gamma' } })
  const ds = makeDs('ds')
  const engine = createDashboardEngine({
    panels: [panel], datasourcePlugins: [ds], variableTypes: [dynamicType], stateStore,
  })

  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [{ name: 'env', type: 'dynamic' }], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 50))

  // gamma is not in [alpha, beta], should fall back to alpha
  assert.equal(engine.getVariable('env')?.value, 'alpha', 'invalid value should fall back to first option')
})

test('valid current value is preserved after options refresh', async () => {
  const stateStore = createMemoryDashboardStateStore({ variables: { env: 'beta' } })
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'alpha', value: 'alpha' }, { label: 'beta', value: 'beta' }]
    },
  })

  const engine = createDashboardEngine({
    panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType], stateStore,
  })

  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [{ name: 'env', type: 'fixed' }], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(engine.getVariable('env')?.value, 'beta', 'valid value should be preserved')
})

// ─── P2-1: dashboard state replacement policy ──────────────────────────────────

test('replace-dashboard-variables replaces stale variable values from previous dashboard', async () => {
  const stateStore = createMemoryDashboardStateStore({ variables: { project: 'old-value' } })
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      // Options do not include 'old-value'
      return [{ label: 'new-default', value: 'new-default' }, { label: 'other', value: 'other' }]
    },
  })

  const engine = createDashboardEngine({
    panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType], stateStore,
  })

  engine.load(
    { schemaVersion: 1, id: 'd', title: 'D', variables: [{ name: 'project', type: 'fixed', defaultValue: 'new-default' }], panels: [] },
    { statePolicy: 'replace-dashboard-variables' },
  )
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(
    engine.getVariable('project')?.value,
    'new-default',
    'replace-dashboard-variables should use dashboard default, not stale state',
  )
})

test('preserve policy keeps existing state values', async () => {
  const stateStore = createMemoryDashboardStateStore({ variables: { env: 'prod' } })
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'prod', value: 'prod' }, { label: 'dev', value: 'dev' }]
    },
  })

  const engine = createDashboardEngine({
    panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType], stateStore,
  })

  engine.load(
    { schemaVersion: 1, id: 'd', title: 'D', variables: [{ name: 'env', type: 'fixed', defaultValue: 'dev' }], panels: [] },
    { statePolicy: 'preserve' },
  )
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(engine.getVariable('env')?.value, 'prod', 'preserve should keep existing state value')
})

test('load with explicit state snapshot applies it', async () => {
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'staging', value: 'staging' }, { label: 'prod', value: 'prod' }]
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType] })

  engine.load(
    { schemaVersion: 1, id: 'd', title: 'D', variables: [{ name: 'env', type: 'fixed', defaultValue: 'prod' }], panels: [] },
    { state: { variables: { env: 'staging' } } },
  )
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(engine.getVariable('env')?.value, 'staging', 'explicit state should win over default')
})

// ─── P3-1: updatePanel ────────────────────────────────────────────────────────

test('updatePanel refreshes only the target panel', async () => {
  const queryCounts: Record<string, number> = {}

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      queryCounts[opts.panelId] = (queryCounts[opts.panelId] ?? 0) + 1
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
      { id: 'p2', type: 'table', gridPos: { x: 6, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
    ],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  const before = { ...queryCounts }

  await engine.updatePanel('p1', { title: 'Updated' })

  assert.equal(queryCounts['p1'], (before['p1'] ?? 0) + 1, 'p1 should re-query after updatePanel')
  assert.equal(queryCounts['p2'], before['p2'], 'p2 should not re-query')
})

test('updatePanel with refresh=false updates config without querying', async () => {
  const queryCounts: Record<string, number> = {}

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      queryCounts[opts.panelId] = (queryCounts[opts.panelId] ?? 0) + 1
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
    ],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  const before = queryCounts['p1'] ?? 0

  await engine.updatePanel('p1', { title: 'Silent' }, { refresh: false })

  assert.equal(queryCounts['p1'] ?? 0, before, 'no query should occur when refresh=false')
  assert.equal(engine.getConfig()?.panels[0]?.title, 'Silent', 'config should be updated')
})

test('updatePanel accepts panel input patch with data request defaults omitted', async () => {
  const queryCounts: Record<string, number> = {}

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      queryCounts[opts.panelId] = (queryCounts[opts.panelId] ?? 0) + 1
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
    ],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  await engine.updatePanel('p1', {
    dataRequests: [{ id: 'next', uid: 'ds', type: 'mock' }],
  }, { refresh: false })

  assert.deepEqual(engine.getConfig()?.panels[0]?.dataRequests[0], {
    id: 'next',
    uid: 'ds',
    type: 'mock',
    options: {},
    hide: false,
    permissions: [],
    staleWhileRevalidate: false,
  })
})

test('updatePanel throws PanelNotFoundError for unknown or repeat instance id', async () => {
  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 20))

  await assert.rejects(
    () => engine.updatePanel('nonexistent', { title: 'X' }),
    (err: Error) => err.name === 'PanelNotFoundError',
  )
})

test('updatePanel rejects patches that change the panel id', async () => {
  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }] },
    ],
  })
  await new Promise<void>((r) => setTimeout(r, 20))

  await assert.rejects(
    () => engine.updatePanel('p1', { id: 'p2' }),
    (err: Error) => err.name === 'PanelValidationError',
  )
})

// ─── P3-2: previewPanel ───────────────────────────────────────────────────────

test('previewPanel uses temp config and does not mutate panel state', async () => {
  let previewQuery: string | undefined

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      if (typeof opts.query === 'string') previewQuery = opts.query
      return { columns: [{ name: 'v', type: 'number' }], rows: [[42]] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [
      { id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 }, dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: 'SELECT original' }] },
    ],
  })

  await new Promise<void>((r) => setTimeout(r, 50))
  const dataBefore = engine.getPanel('p1')?.data

  const result = await createEditorAddon(engine).previewPanel('p1', {
    id: 'p1',
    type: 'table',
    gridPos: { x: 0, y: 0, w: 6, h: 4 },
    dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: 'SELECT preview' }],
  })

  assert.equal(previewQuery, 'SELECT preview', 'preview should use temp query')
  assert.deepEqual(engine.getPanel('p1')?.data, dataBefore, 'panel state should not be mutated by preview')
  assert.ok(Array.isArray(result.rawData), 'preview result should have rawData')
})

test('previewPanel can be aborted via caller signal', async () => {
  let aborted = false

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      await new Promise<void>((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          aborted = true
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
        })
      })
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 20))

  const ac = new AbortController()
  const promise = createEditorAddon(engine).previewPanel(
    'nonexistent',
    {
      id: 'tmp',
      type: 'table',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
    },
    { signal: ac.signal },
  )

  setTimeout(() => ac.abort(), 10)
  await assert.rejects(promise)
  assert.ok(aborted, 'datasource signal should be aborted')
})

test('previewPanel rejects immediately when caller signal is already aborted', async () => {
  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [] })
  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 20))

  const ac = new AbortController()
  ac.abort()

  await assert.rejects(
    () => createEditorAddon(engine).previewPanel(
      'p1',
      {
        id: 'p1',
        type: 'table',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock' }],
      },
      { signal: ac.signal },
    ),
    (err: Error) => err.name === 'AbortError',
  )
})

// ─── P4-1: includeAll / allValue ──────────────────────────────────────────────

test('includeAll injects an All option at the top', async () => {
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'alpha', value: 'alpha' }, { label: 'beta', value: 'beta' }]
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'env', type: 'fixed', includeAll: true }],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  const varState = engine.getVariable('env')
  assert.ok(varState?.options[0]?.value === '$__all', 'first option should be All')
  assert.ok(varState?.options.length === 3, 'should have All + 2 concrete options')
})

test('allValue is passed to datasource when All is selected', async () => {
  let receivedVar: string | string[] | undefined

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      receivedVar = opts.variables['env']
      return { columns: [], rows: [] }
    },
  })

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'alpha', value: 'alpha' }, { label: 'beta', value: 'beta' }]
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'env', type: 'fixed', includeAll: true, allValue: '.*' }],
    panels: [
      {
        id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: '$env' }],
      },
    ],
  })
  await new Promise<void>((r) => setTimeout(r, 80))

  // All should be auto-selected (first option) and allValue should be used
  assert.equal(receivedVar, '.*', 'allValue should be passed to datasource when All is selected')
})

test('without allValue, All expands to array of concrete values', async () => {
  let receivedVar: string | string[] | undefined

  const ds = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(opts) {
      receivedVar = opts.variables['env']
      return { columns: [], rows: [] }
    },
  })

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'alpha', value: 'alpha' }, { label: 'beta', value: 'beta' }]
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'env', type: 'fixed', includeAll: true }],
    panels: [
      {
        id: 'p1', type: 'table', gridPos: { x: 0, y: 0, w: 6, h: 4 },
        dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: '$env' }],
      },
    ],
  })
  await new Promise<void>((r) => setTimeout(r, 80))

  assert.deepEqual(receivedVar, ['alpha', 'beta'], 'without allValue, All should be passed as concrete option array')
})

// ─── P4-2: variable sort ──────────────────────────────────────────────────────

test('alphaAsc sort orders options alphabetically ascending', async () => {
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: 'gamma', value: 'gamma' }, { label: 'alpha', value: 'alpha' }, { label: 'beta', value: 'beta' }]
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'env', type: 'fixed', sort: 'alphaAsc' }],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  const opts = engine.getVariable('env')?.options.map((o) => o.value)
  assert.deepEqual(opts, ['alpha', 'beta', 'gamma'])
})

test('numericAsc sort orders options numerically ascending', async () => {
  const ds = makeDs('ds')

  const fixedType = defineVariableType({
    id: 'fixed',
    name: 'Fixed',
    optionsSchema: {},
    async resolve() {
      return [{ label: '10', value: '10' }, { label: '2', value: '2' }, { label: '1', value: '1' }]
    },
  })

  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [fixedType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'count', type: 'fixed', sort: 'numericAsc' }],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  const opts = engine.getVariable('count')?.options.map((o) => o.value)
  assert.deepEqual(opts, ['1', '2', '10'])
})

test('variable dataRequest options participate in dependency cascade', async () => {
  const resolvedNames: string[] = []
  let valueCounter = 0

  const trackType = defineVariableType({
    id: 'track',
    name: 'Track',
    optionsSchema: {},
    async resolve(config) {
      resolvedNames.push(config.name)
      valueCounter += 1
      return [{ label: `${config.name}-${valueCounter}`, value: `${config.name}-${valueCounter}` }]
    },
  })

  const ds = makeDs('ds')
  const engine = createDashboardEngine({ panels: [panel], datasourcePlugins: [ds], variableTypes: [trackType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [
      { name: 'varA', type: 'track' },
      { name: 'varB', type: 'track', dataRequest: { id: 'opts', uid: 'ds', type: 'mock', options: { parent: '$varA' } } },
    ],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))
  resolvedNames.length = 0

  await engine.refreshVariable('varA')

  assert.ok(resolvedNames.includes('varB'), 'varB should refresh when it references varA in dataRequest options')
})

test('time range change refreshes variables marked refreshOnTimeRangeChange', async () => {
  let resolveCount = 0

  const timeType = defineVariableType({
    id: 'time-aware',
    name: 'Time aware',
    optionsSchema: {},
    async resolve() {
      resolveCount += 1
      return [{ label: `value-${resolveCount}`, value: `value-${resolveCount}` }]
    },
  })

  const ds = makeDs('ds')
  const stateStore = createMemoryDashboardStateStore()
  const engine = createDashboardEngine({ stateStore, panels: [panel], datasourcePlugins: [ds], variableTypes: [timeType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'windowed', type: 'time-aware', refreshOnTimeRangeChange: true }],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(resolveCount, 1)
  stateStore.setPatch({ timeRange: { from: 'now-1h', to: 'now' } })
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(resolveCount, 2)
  assert.equal(engine.getVariable('windowed')?.value, 'value-2')
})

test('time range change does not refresh unmarked variables', async () => {
  let resolveCount = 0

  const timeType = defineVariableType({
    id: 'time-aware',
    name: 'Time aware',
    optionsSchema: {},
    async resolve() {
      resolveCount += 1
      return [{ label: `value-${resolveCount}`, value: `value-${resolveCount}` }]
    },
  })

  const ds = makeDs('ds')
  const stateStore2 = createMemoryDashboardStateStore()
  const engine = createDashboardEngine({ stateStore: stateStore2, panels: [panel], datasourcePlugins: [ds], variableTypes: [timeType] })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'stable', type: 'time-aware' }],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(resolveCount, 1)
  stateStore2.setPatch({ timeRange: { from: 'now-1h', to: 'now' } })
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(resolveCount, 1)
  assert.equal(engine.getVariable('stable')?.value, 'value-1')
})

test('external state store time range changes refresh marked variables and cascade downstream', async () => {
  const resolvedNames: string[] = []
  let valueCounter = 0

  const cascadeType = defineVariableType({
    id: 'cascade',
    name: 'Cascade',
    optionsSchema: {},
    async resolve(config) {
      resolvedNames.push(config.name)
      valueCounter += 1
      return [{ label: `${config.name}-${valueCounter}`, value: `${config.name}-${valueCounter}` }]
    },
  })

  const stateStore = createMemoryDashboardStateStore()
  const ds = makeDs('ds')
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [ds],
    variableTypes: [cascadeType],
    stateStore,
  })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [
      { name: 'varA', type: 'cascade', refreshOnTimeRangeChange: true },
      { name: 'varB', type: 'cascade', dataRequest: { id: 'b', uid: 'ds', type: 'mock', query: '$varA' } },
    ],
    panels: [],
  })
  await new Promise<void>((r) => setTimeout(r, 50))
  resolvedNames.length = 0

  stateStore.setPatch({ timeRange: { from: 'now-2h', to: 'now' } })
  await new Promise<void>((r) => setTimeout(r, 50))

  assert.ok(resolvedNames.includes('varA'), 'marked variable should refresh on external time range change')
  assert.ok(resolvedNames.includes('varB'), 'downstream variable should cascade after marked variable changes')
})

test('previewDataRequest runs one request without mutating panel state', async () => {
  let calls = 0
  let lastOptions: QueryOptions | undefined
  const datasource = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(options) {
      calls += 1
      lastOptions = options
      return { columns: [{ name: 'value', type: 'number' }], rows: [[calls]] }
    },
  })
  const constantType = defineVariableType({
    id: 'constant',
    name: 'Constant',
    optionsSchema: {},
    async resolve(config) {
      const value = Array.isArray(config.defaultValue) ? config.defaultValue[0] : config.defaultValue
      return value ? [{ label: value, value }] : []
    },
  })
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [datasource],
    variableTypes: [constantType],
  })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [{ name: 'env', type: 'constant', defaultValue: 'prod', options: {} }],
    panels: [{
      id: 'p1',
      type: 'table',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataRequests: [{ id: 'main', uid: 'ds', type: 'mock', query: 'normal' }],
    }],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  const before = engine.getPanel('p1')
  const result = await createEditorAddon(engine).previewDataRequest(
    { id: 'preview', uid: 'ds', type: 'mock', query: 'preview' },
    { variablesOverride: { env: 'staging' } },
  )

  assert.deepEqual(result.rows, [[2]])
  assert.equal(calls, 2)
  assert.equal(lastOptions?.panelId, '')
  assert.equal(lastOptions?.requestId, 'preview')
  assert.equal(lastOptions?.query, 'preview')
  assert.deepEqual(lastOptions?.variables, { env: 'staging' })
  assert.equal(lastOptions?.panel, undefined)
  assert.equal(engine.getPanel('p1'), before)
})

test('previewDataRequest includes panel context when panelId is provided', async () => {
  let lastOptions: QueryOptions | undefined
  const datasource = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query(options) {
      lastOptions = options
      return { columns: [], rows: [] }
    },
  })
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [datasource],
    variableTypes: [],
  })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [{
      id: 'p1',
      type: 'table',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      options: { color: 'red' },
      dataRequests: [],
    }],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  await createEditorAddon(engine).previewDataRequest(
    { id: 'preview', uid: 'ds', type: 'mock' },
    { panelId: 'p1' },
  )

  assert.equal(lastOptions?.panelId, 'p1')
  assert.equal(lastOptions?.panel?.id, 'p1')
  assert.deepEqual(lastOptions?.panelOptions, { color: 'red' })
  assert.equal(lastOptions?.panelInstance?.id, 'p1')
})

test('previewDataRequest auth denial rejects without calling datasource', async () => {
  let calls = 0
  const datasource = defineDatasource({
    uid: 'ds',
    type: 'mock',
    async query() {
      calls += 1
      return { columns: [], rows: [] }
    },
  })
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [datasource],
    variableTypes: [],
    authorize({ action }) {
      if (action === 'datasource:query') return { allowed: false, reason: 'preview denied' }
      return true
    },
  })

  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 50))

  await assert.rejects(
    () => createEditorAddon(engine).previewDataRequest({ id: 'preview', uid: 'ds', type: 'mock' }),
    /preview denied/,
  )
  assert.equal(calls, 0)
})

test('previewDataRequest can be aborted via caller signal', async () => {
  const ac = new AbortController()
  const datasource = defineDatasource({
    uid: 'ds',
    type: 'mock',
    query(options) {
      return new Promise<QueryResult>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
          return
        }
        options.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
        })
      })
    },
  })
  const engine = createDashboardEngine({
    panels: [panel],
    datasourcePlugins: [datasource],
    variableTypes: [],
  })

  engine.load({ schemaVersion: 1, id: 'd', title: 'D', variables: [], panels: [] })
  await new Promise<void>((r) => setTimeout(r, 50))

  const promise = createEditorAddon(engine).previewDataRequest(
    { id: 'preview', uid: 'ds', type: 'mock' },
    { signal: ac.signal },
  )
  ac.abort()
  await assert.rejects(promise, (err: Error) => err.name === 'AbortError')
})
