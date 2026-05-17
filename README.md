# @loykin/dashboardkit

A headless TypeScript dashboard runtime for building dashboard viewers and
builders. It owns the loaded dashboard config, resolves variables, runs panel
queries, expands runtime panel instances, and exposes the latest saveable config.

The library is not a full dashboard application. It does not store dashboards in
a database, manage datasource credentials, or dictate your UI design.

## Features

- **Headless runtime**: bring your own layout, panels, editor UI, and persistence
- **Single source of truth**: after `load()`, the engine owns the editable
  dashboard config
- **Config CRUD**: add/remove panels, add/update/remove variables, update
  dashboard metadata, then save with `getConfig()`
- **Plugin model**: datasource adapter plus panel, variable type, and transform plugins
- **Optional structured requests**: panels can omit datasources entirely, or use
  `dataRequests[]` with datasource identity, query descriptor, request options,
  permissions, and hide state
- **Variable engine**: dependency DAG, downstream refresh, include-all, sorting,
  readiness checks, and time-range refresh support
- **URL-safe state model**: variables, time range, and refresh can come from URL
  query params without pruning unknown app-owned query keys
- **Panel expansion**: repeat panels and row collapse are runtime expansions, not
  saved panel copies
- **Panel query cache**: panel-scoped cache with targeted invalidation
- **Authorization hook**: block panel, variable, and datasource queries before a
  datasource adapter runs
- **Addon model**: cross-filter, panel editor helpers, and annotations are
  opt-in addons built on the public engine API
- **React adapter**: `DashboardGrid`, hooks, and URL state adapter are optional
  entrypoints
- **ESM + CJS**: ships both builds with full TypeScript declarations

## Installation

```bash
pnpm add @loykin/dashboardkit
```

React rendering helpers are optional but require these peer dependencies:

```bash
pnpm add react react-dom react-grid-layout
```

`zod` and `zustand` are bundled dependencies and do not need to be installed
separately.

## Package Entrypoints

```ts
import { createDashboardEngine } from '@loykin/dashboardkit'
import { DashboardGrid, usePanel } from '@loykin/dashboardkit/react'
import { createBrowserDashboardStateStore } from '@loykin/dashboardkit/url-state'
```

## Core Model

DashboardKit separates two kinds of state:

- **Dashboard config** — panels, variables, layout, links, permissions. After
  `engine.load(config)` the engine owns this and exposes it through CRUD APIs.
- **Dashboard input state** — selected variable values, time range, and refresh
  interval. This lives in a `DashboardStateStore`, which can be memory-backed,
  URL-backed, or app-provided.

Unknown URL query params are preserved. A variable named `country` reads/writes
`var-country` but the library never touches unrelated keys like `auth-token` or
app-specific router params.

## Quick Start

```tsx
import {
  createDashboardEngine,
  builtinVariableTypes,
  definePanel,
  queryResultToTableRows,
  tableRowsToQueryResult,
} from '@loykin/dashboardkit'
import type { DashboardDatasourceAdapter, PanelViewerProps } from '@loykin/dashboardkit'
import {
  DashboardGrid,
  useLoadDashboard,
} from '@loykin/dashboardkit/react'

// 1. Implement a datasource adapter
const myDatasource: DashboardDatasourceAdapter = {
  async query(request, context) {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: request.query,
        variables: context.variables,
        timeRange: context.timeRange,
      }),
    })
    return tableRowsToQueryResult(await res.json())
  },
}

// 2. Define a panel plugin — transform + viewer in one place
const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  transform(results) {
    return results[0] ? queryResultToTableRows(results[0]).rows : []
  },
  viewer({ data, loading, error }: PanelViewerProps<unknown, unknown[][]>) {
    if (loading) return <div>Loading…</div>
    if (error)   return <div>{error}</div>
    return <pre>{JSON.stringify(data, null, 2)}</pre>
  },
})

// 3. Create the engine
const engine = createDashboardEngine({
  datasourceAdapter: myDatasource,
  panels: [tablePanel],
  variableTypes: builtinVariableTypes,
})

// 4. Define a dashboard config
const dashboard = {
  schemaVersion: 1 as const,
  id: 'sales',
  title: 'Sales',
  variables: [
    {
      name: 'country',
      type: 'query',
      label: 'Country',
      dataRequest: { id: 'q', uid: 'main-api', type: 'backend', query: 'countries' },
    },
  ],
  panels: [
    {
      id: 'orders',
      type: 'table',
      title: 'Orders',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      dataRequests: [
        { id: 'main', uid: 'main-api', type: 'backend', query: 'orders.list', options: { country: '$country' } },
      ],
    },
  ],
}

// 5. Render — generic renderer looks up the registered viewer by panel type
function DashboardPage() {
  useLoadDashboard(engine, dashboard)

  return (
    <DashboardGrid engine={engine}>
      {({ panelType, data, loading, error, options, config, rawData, ref }) => {
        const Viewer = engine.getPanelPlugin(panelType)?.viewer
        return (
          <div ref={ref as React.Ref<HTMLDivElement>} style={{ height: '100%' }}>
            {Viewer
              ? <Viewer data={data} loading={loading} error={error} options={options} panel={config} variables={{}} width={0} height={0} rawData={rawData} />
              : <div>Unknown panel: {panelType}</div>}
          </div>
        )
      }}
    </DashboardGrid>
  )
}
```

### Variable dependency detection

The engine scans panel titles, repeat expressions, `dataRequests[].query`,
`dataRequests[].options`, and panel `options` for `$varname` references to build
the dependency graph. Variable query requests are scanned the same way. A panel
only re-queries when a variable it references changes. **There is no separate
declaration** — putting `country: '$country'` anywhere in the request or panel
options is sufficient.

## Builder Flow

```ts
// Add a panel
await engine.addPanel({
  id: 'latency',
  type: 'stat',
  title: 'P95 Latency',
  gridPos: { x: 0, y: 0, w: 6, h: 4 },
  dataRequests: [{ id: 'q', uid: 'main-api', type: 'backend', query: 'latency.p95' }],
})

// Update a panel (cannot change its id)
await engine.updatePanel('latency', { title: 'Latency (p95)', options: { unit: 'ms' } })

// Remove a panel
await engine.removePanel('latency')

// Add a variable
await engine.addVariable({ name: 'env', type: 'custom', options: { values: 'prod,staging' } })

// Update a variable (cannot rename — update all $env references manually first)
await engine.updateVariable('env', { label: 'Environment', defaultValue: 'prod' })

// Remove a variable
await engine.removeVariable('env')

// Patch dashboard metadata (cannot change id, schemaVersion, panels, or variables)
await engine.updateDashboard({ title: 'Production dashboard', tags: ['prod'] })

// Save and reload
const saved = engine.getConfig()
// ... persist saved somewhere ...
engine.load(saved, { statePolicy: 'preserve' }) // keeps variable selections
```

`statePolicy` options:

| Value | Behaviour |
|---|---|
| `'preserve'` | Keep current variable values and time range |
| `'replace-dashboard-variables'` | Reset variable values from config defaults |
| _(omitted)_ | Reset all input state |

## Datasource Adapter

DashboardKit queries data through a single `DashboardDatasourceAdapter`
interface. The engine has no built-in notion of individual datasource plugins —
you provide one object that implements the adapter, and the engine calls it for
every panel query, variable query, and annotation query.

This makes it straightforward to connect any execution layer: a direct fetch, a
datasource manager package (such as a future `@loykin/datasourcekit`), a mock,
or a proxy to a backend API.

Datasources are optional. A dashboard can render static, derived, embedded, or
app-owned panels without configuring any datasource adapter as long as those
panels do not declare `dataRequests[]`.

```ts
import { tableRowsToQueryResult } from '@loykin/dashboardkit'
import type { DashboardDatasourceAdapter } from '@loykin/dashboardkit'

const adapter: DashboardDatasourceAdapter = {
  // Required: called for every panel data request
  async query(request, context) {
    // DashboardKit does NOT interpolate queries — decide here how to use
    // the raw query descriptor and resolved variables.
    const { variables, timeRange, signal } = context
    const res = await fetch('/api/query', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: request.query, variables, timeRange }),
    })
    return tableRowsToQueryResult(await res.json())
  },

  // Optional: streaming alternative — return an unsubscribe function
  subscribe(request, context, onData, onError) {
    const ws = openWebSocket(request.query, context)
    ws.onmessage = (e) => onData(JSON.parse(e.data))
    ws.onerror = (e) => onError(new Error(String(e)))
    return () => ws.close()
  },

  // Optional: called for `query`-type variables
  async metricFindQuery(request, context) {
    const items = await fetch(`/api/lookup?q=${request.query}&env=${context.variables['env']}`).then((r) => r.json())
    return items.map((v: string) => ({ label: v, value: v }))
  },
}
```

`query()` and all other methods receive a `DashboardDatasourceContext`:

```ts
interface DashboardDatasourceContext {
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string; raw?: { from: string; to: string } }
  authContext?: AuthContext
  signal?: AbortSignal
  builtins?: Record<string, string>
  // set when called from a panel query
  dashboardId?: string
  panelId?: string
  requestId?: string
}
```

For multi-datasource routing, implement the dispatch yourself:

```ts
const adapters = new Map([
  ['prometheus', prometheusAdapter],
  ['postgres', postgresAdapter],
])

const adapter: DashboardDatasourceAdapter = {
  query(request, context) {
    const ds = adapters.get(request.uid)
    if (!ds) return Promise.reject(new Error(`datasource "${request.uid}" not found`))
    return ds.query(request, context)
  },
}
```

Return value must be `QueryResult` — the frame-oriented shape where each frame
is a named table or series with typed fields and columnar values.

```ts
interface QueryResult {
  frames: Array<{
    name?: string
    frameType: string
    fields: Array<{
      name: string
      type?: string
      labels?: Record<string, string>
      values: unknown[]
      meta?: Record<string, unknown>
    }>
    meta?: Record<string, unknown>
  }>
  stats?: QueryStats
  inspect?: QueryInspect
  meta?: Record<string, unknown>
}
```

`tableRowsToQueryResult()` and `queryResultToTableRows()` are convenience
helpers for panels or backends that still prefer row-oriented `{ columns, rows }`
tables at their boundary.

## Panel Plugin

```tsx
import { definePanel, applyOptionDefaults, queryResultToTableRows } from '@loykin/dashboardkit'
import type { PanelViewerProps } from '@loykin/dashboardkit/react'

interface StatOptions { unit: string; threshold: number; color: string }

const statPanel = definePanel({
  id: 'stat',
  name: 'Stat',
  optionsSchema: {
    unit:      { type: 'string', label: 'Unit', default: 'short' },
    threshold: { type: 'number', label: 'Threshold', default: 0, min: 0 },
    color:     { type: 'color',  label: 'Color', default: '#3b82f6' },
    inverted:  { type: 'boolean', label: 'Invert', default: false },
    mode:      { type: 'select', label: 'Mode', default: 'last',
                 choices: [{ label: 'Last', value: 'last' }, { label: 'Sum', value: 'sum' }] },
  },
  transform(results: QueryResult[]) {
    const rows = results[0] ? queryResultToTableRows(results[0]).rows : []
    return rows.at(-1)?.[0] ?? null
  },
  viewer({ data, loading, error, options: rawOptions, panel }: PanelViewerProps<StatOptions, unknown>) {
    const options = applyOptionDefaults(statPanel.optionsSchema, rawOptions) as StatOptions
    if (loading) return <div>Loading…</div>
    if (error)   return <div style={{ color: 'red' }}>{error}</div>
    return (
      <div style={{ color: options.color, fontSize: 32, textAlign: 'center' }}>
        {String(data ?? '—')} {options.unit}
      </div>
    )
  },
})
```

`viewer` is the React component registered for this panel type. The engine
renders it via `getPanelPlugin(type)?.viewer` — no manual `if (type === 'stat')`
switch needed. `applyOptionDefaults` fills in missing fields from `optionsSchema`.

Option schema field types: `string`, `number`, `boolean`, `select`,
`multiselect`, `color`, `json`, `array`. Validation metadata: `required`,
`default`, `min`, `max`, `integer`, `minLength`, `maxLength`, `pattern`,
`choices`, `items`, `minItems`, `maxItems`, custom `validate()`.

## Variable Types

Pass `builtinVariableTypes` to the engine to enable the built-in variable types.
Without it, none of the types below will resolve.

```ts
import { createDashboardEngine, builtinVariableTypes } from '@loykin/dashboardkit'

const engine = createDashboardEngine({
  variableTypes: builtinVariableTypes,
  // ...
})
```

Built-in types:

| `type` | Description |
|---|---|
| `query` | Calls `datasource.variable.metricFindQuery(query, ctx)` and populates options from the result |
| `custom` | Comma-separated static values. `options.values = 'KR,US,JP'` |
| `textbox` | Free-text input with `defaultValue` |
| `constant` | Fixed hidden value |
| `interval` | Time interval picker (`1m`, `5m`, `1h`, …) |
| `datetime` | Time range via `from`/`to` builtins |
| `refresh` | Auto-refresh interval |

Custom variable types can be added with `defineVariableType()`:

```ts
import { defineVariableType } from '@loykin/dashboardkit'

const myType = defineVariableType<{ endpoint: string }>({
  id: 'my-type',
  name: 'My Type',
  optionsSchema: { endpoint: { type: 'string', label: 'Endpoint' } },
  async resolve(config, options, ctx) {
    const items = await fetch(options.endpoint).then((r) => r.json())
    return items.map((v: string) => ({ label: v, value: v }))
  },
})

const engine = createDashboardEngine({
  variableTypes: [...builtinVariableTypes, myType],
})
```

## State Store and URL State

```ts
import { createBrowserDashboardStateStore } from '@loykin/dashboardkit/url-state'

const stateStore = createBrowserDashboardStateStore()

const engine = createDashboardEngine({ stateStore, datasourceAdapter, panels, variableTypes })

// Load with preserved variable values from URL
engine.load(config, { statePolicy: 'preserve' })

// Write state — syncs to URL query params automatically
engine.setVariable('country', 'KR')
stateStore.setPatch({ timeRange: { from: 'now-6h', to: 'now' }, refresh: '30s' })
```

Variable `country` reads/writes `?var-country=KR`. Unknown URL params are
preserved.

## Addons

Addons are opt-in and built on top of `CoreEngineAPI`. They do not modify the
engine — they return a separate API object.

### Cross-filter

```ts
import { createCrossFilterAddon } from '@loykin/dashboardkit'

const cf = createCrossFilterAddon(engine)

cf.setPanelSelection('bar-chart', { region: 'KR' }) // scopes other panels' queries
cf.clearPanelSelection('bar-chart')
cf.clearAllPanelSelections()
cf.getPanelSelections() // → Record<panelId, Record<dimension, value>>
```

`setPanelSelection` writes a query scope to the target panel via
`engine.setPanelQueryScope()`, then invalidates the cache and refreshes all
panels. The scope values are merged into `variables` when querying other panels.

### Editor

```ts
import { createEditorAddon } from '@loykin/dashboardkit'

const editor = createEditorAddon(engine)

// Preview a data request without committing it
const result = await editor.previewDataRequest({
  id: 'preview', uid: 'main-api', type: 'backend', query: 'orders.list',
})

// Preview a panel with a temporary config (for live editor preview)
const { data, rawData } = await editor.previewPanel('orders', {
  ...currentPanel,
  dataRequests: [{ id: 'q', uid: 'main-api', type: 'backend', options: { by: 'country' } }],
})
```

## React Adapter

### DashboardGrid

```tsx
import { DashboardGrid } from '@loykin/dashboardkit/react'

<DashboardGrid engine={engine} editable onLayoutChange={handleLayout}>
  {(props) => (
    // props: { panelId, panelType, instance, config, options, data, loading, error, ref }
    <MyPanel {...props} />
  )}
</DashboardGrid>
```

`DashboardGrid` measures its container width and drives the react-grid-layout
underneath. Pass `editable` to enable drag and resize.

`PanelRenderProps`:

```ts
interface PanelRenderProps {
  panelId: string
  panelType: string
  instance: PanelRuntimeInstance  // runtime-expanded instance (may differ from origin for repeat panels)
  config: PanelConfig             // resolved panel config
  options: Record<string, unknown>
  data: unknown                   // output of panel.transform(results)
  rawData: QueryResult[] | null
  loading: boolean
  error: string | null
  ref: React.RefCallback<HTMLElement>  // attach to panel root for viewport virtualization
}
```

### Hooks

```ts
// Load a dashboard config into the engine (idempotent — skips if same ref)
useLoadDashboard(engine, config, options?)

// Subscribe to panel state (data, loading, error)
const { data, loading, error } = usePanel<T>(engine, panelId)

// Subscribe to a variable (value, options list, loading, setter)
const { value, options, loading, setValue } = useVariable(engine, name)

// Subscribe to all engine events
useEngineEvent(engine, (event) => { ... })

// Notify when dashboard config changes
useConfigChanged(engine, () => { ... })

// Draft editor helpers — keeps uncommitted state separate from the engine
const draft = usePanelDraftEditor(engine, panelId)
```

### Engine Events

```ts
engine.subscribe((event) => {
  switch (event.type) {
    case 'config-changed':      // dashboard config was mutated
    case 'panel-data-changed':  // a panel finished loading
    case 'variable-changed':    // a variable value or options changed
    case 'panel-selection-changed': // cross-filter selection changed
    case 'authorization-denied':    // a query was blocked by the authorize hook
  }
})
```

## API Overview

### Engine

```ts
// Config
engine.load(config, options?)                     // { statePolicy?: 'preserve' | 'replace-dashboard-variables' }
engine.getConfig()                                // → DashboardConfig | null

// Panels
engine.addPanel(panel, options?)
engine.updatePanel(panelId, patch, options?)
engine.removePanel(panelId, options?)
engine.getPanelInstances()                        // runtime-expanded instances
engine.getPanelInstance(instanceId)
engine.getPanelDependencies(panelId)              // which variables a panel depends on
engine.getPanelReadiness(panelId)
engine.refreshPanel(panelId)
engine.refreshAll()
engine.validatePanelOptions(type, options)

// Variables
engine.addVariable(variable, options?)
engine.updateVariable(name, patch, options?)
engine.removeVariable(name, options?)
engine.setVariable(name, value)
engine.getVariable(name)
engine.refreshVariable(name)
engine.refreshVariables()
engine.getVariableReadiness(names)

// Dashboard metadata
engine.updateDashboard(patch, options?)
engine.getTimeRange()                             // read-only; write via stateStore
engine.getRefresh()                               // read-only; write via stateStore

// Authorization
engine.setAuthContext(context)
engine.getAuthContext()

// Primitives (for addon authoring)
engine.setPanelQueryScope(panelId, scope | null)  // cross-filter scope per panel
engine.getPanelQueryScopes()
engine.executeDataRequest(request, options?)      // can run without a loaded dashboard
engine.listDatasourceNamespaces(datasourceUid, options?)
engine.listDatasourceFields(datasourceUid, request, options?)
engine.healthCheckDatasource(datasourceUid, options?)
engine.validateDatasourceQuery(datasourceUid, query, options?)
engine.applyPanelTransforms(type, results)
engine.invalidateCache(panelIds?)
engine.queryAnnotations(timeRange?)

// Lifecycle
engine.abortAll()   // cancel in-flight requests (keep engine alive)
engine.destroy()    // cancel requests + clear listeners + unsubscribe store

// Runtime registration (add plugins after creation)
engine.registerPanel(def)
engine.registerVariableType(def)
engine.registerTransform(def)

// Events
engine.subscribe(listener)     // → unsubscribe function
```

## Query Interpolation

`interpolate()` is a standalone utility — it is not called automatically by the
engine. Use it inside a datasource `queryData()` when you want template-style variable
substitution.

```ts
import { interpolate } from '@loykin/dashboardkit'
import type { DashboardDatasourceAdapter } from '@loykin/dashboardkit'

const postgresAdapter: DashboardDatasourceAdapter = {
  async query(request, context) {
    const sql = interpolate(String(request.query), {
      variables: context.variables,
      builtins: {
        from: String(context.timeRange?.from ?? ''),
        to:   String(context.timeRange?.to   ?? ''),
      },
      functions: {},
      formatters: {
        // custom format: ${city:sqlin} → 'seoul', 'busan'
        sqlin: (val) =>
          (Array.isArray(val) ? val : [val]).map((v) => `'${v}'`).join(', '),
      },
    })
    return runQuery(sql)
  },
}
```

Built-in format specifiers: `csv`, `pipe`, `json`, `sqlstring`, `sqlin`,
`glob`, `regex`, `queryparam`, `text`, `raw`.

Syntax:
- `$varname` — default format
- `${varname:format}` — named format
- `$__timeFilter(col)` — built-in function (if registered in `functions`)

## Template Adapter

DashboardKit uses `templateAdapter.parseRefs()` only for dependency detection.
The default adapter understands `$country` and `${country:sqlstring}` syntax.
If your app uses another template syntax, inject an adapter when creating the
engine:

```ts
const engine = createDashboardEngine({
  datasourceAdapter,
  panels,
  variableTypes: builtinVariableTypes,
  templateAdapter: {
    parseRefs(template) {
      const refs = [...template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g)]
        .map((m) => m[1])
      return { refs: [...new Set(refs)], template }
    },
  },
})
```

This connects custom syntax such as `{{country}}` to the variable dependency
DAG, downstream variable refresh, and panel refresh. It does not change query
rendering: datasources or application code still decide how to interpolate the
actual query text before execution.

## Transforms

Panel plugins can call `applyTransforms()` directly, or use
`engine.applyPanelTransforms(type, results)` to apply the transform list declared
on a panel plugin. Built-ins include row filtering, grouping, sorting,
calculated fields, renaming, merging, and `joinByField`.

```ts
import { applyTransforms } from '@loykin/dashboardkit'

const joined = applyTransforms(results, [
  { type: 'joinByField', field: 'host', mode: 'outer' },
])
```

## Authorization

```ts
const engine = createDashboardEngine({
  authContext: { subject: { id: 'user-1', roles: ['viewer'] } },
  authorize(request) {
    // request.action: 'datasource:query' | 'variable:query' | 'annotation:query'
    // request.resourceId: datasource uid
    // request.context: { panelId?, variableName?, dashboardId }
    if (request.action === 'datasource:query' && request.resourceId === 'admin-only') {
      return { allowed: false, reason: 'Viewers cannot query admin datasource' }
    }
    return true
  },
})

// Update auth context at runtime (e.g. after login)
engine.setAuthContext({ subject: { id: 'user-2', roles: ['admin'] } })
```

## Engine Lifecycle

The engine should live for the lifetime of the dashboard session. Abort in-flight
requests when navigating away, and destroy when the engine is no longer needed.

```ts
// React — abort when leaving the dashboard section, destroy on app unmount
useEffect(() => () => engine.abortAll(), [engine])   // layout-level effect
useEffect(() => () => engine.destroy(),  [engine])   // app-level effect
```

## Dashboard Config Schema

```ts
interface DashboardInput {
  schemaVersion: 1
  id: string
  title: string
  description?: string
  tags?: string[]
  variables?: VariableInput[]
  panels: PanelInput[]
  layout?: { cols?: number; rowHeight?: number }
  timeRange?: { from?: string; to?: string }
  refresh?: '' | '5s' | '10s' | '30s' | '1m' | '5m' | '15m' | '30m' | '1h'
  links?: PanelLink[]
  permissions?: PermissionRule[]
}
```

`schemaVersion` is currently `1`. `DashboardInput` accepts omitted defaults;
`DashboardConfig` is the fully-parsed output.

## Playground

The playground lives in `playground/` and is the single deployable demo app.
It includes a full dashboard demo (panel editor, variables, datasource management)
alongside feature-specific examples for every engine capability.

```bash
cd playground
pnpm dev
```

Navigate using the sidebar. Key sections:

- **Full Dashboard** — complete dashboard with panel editor, variable bar,
  datasource CRUD, cross-filter, and stale-data-while-loading behavior
- **Operations Viewer** — variables, time range, row panels, editable grid
- **Explore Cross-filter** — chart cross-filtering and preview/edit sync
- **Builder Lifecycle** — config CRUD, save with `getConfig()`, reload
- **interpolate()** — variable interpolation with custom formatters
- **Template Adapter** — custom `{{var}}` dependency parsing
- **Transforms** — transform pipeline including `joinByField`
- **URL State** — URL-backed dashboard state store

## Development

```bash
pnpm type-check
pnpm test
pnpm build
pnpm pack --dry-run
```

## License

MIT
