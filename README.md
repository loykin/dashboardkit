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
- **Plugin model**: datasource, panel, and variable type plugins
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
  datasource plugin runs
- **Addon model**: cross-filter, panel editor helpers, and annotations are
  opt-in addons built on the public engine API
- **React adapter**: `DashboardGrid`, hooks, and URL state adapter are optional
  entrypoints
- **ESM + CJS**: ships both builds with full TypeScript declarations

## Installation

```bash
pnpm add @loykin/dashboardkit
```

Install DatasourceKit directly when a runtime needs datasource execution without
DashboardKit:

```bash
pnpm add @loykin/datasourcekit
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
import { createDatasourceExecutor } from '@loykin/datasourcekit'
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
  defineDatasource,
  definePanel,
} from '@loykin/dashboardkit'
import {
  DashboardGrid,
  useLoadDashboard,
  usePanel,
} from '@loykin/dashboardkit/react'

// 1. Define a datasource plugin
const myDatasource = defineDatasource({
  uid: 'main-api',
  type: 'backend',
  async queryData(_request, {  query, variables, timeRange, datasourceOptions  }) {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables, timeRange }),
    })
    // Must return { columns: [{name, type}], rows: unknown[][] }
    return res.json()
  },
})

// 2. Define a panel plugin
const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  transform(results) {
    // results is QueryResult[]. Return whatever shape your component needs.
    return results[0]?.rows ?? []
  },
})

// 3. Create the engine — pass builtinVariableTypes to enable query/custom/textbox variables
const engine = createDashboardEngine({
  datasourcePlugins: [myDatasource],
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
        // Include "$country" in options so the engine detects the variable dependency
        { id: 'main', uid: 'main-api', type: 'backend', query: 'orders.list', options: { country: '$country' } },
      ],
    },
  ],
}

// 5. Render
function DashboardPage() {
  useLoadDashboard(engine, dashboard)

  return (
    <DashboardGrid engine={engine}>
      {(props) => <TablePanel panelId={props.panelId} />}
    </DashboardGrid>
  )
}

function TablePanel({ panelId }: { panelId: string }) {
  const { data, loading, error } = usePanel<unknown[][]>(engine, panelId)
  if (loading) return <div>Loading…</div>
  if (error)   return <div>{error}</div>
  return <pre>{JSON.stringify(data, null, 2)}</pre>
}
```

### Variable dependency detection

The engine scans panel `dataRequests[].options` (as JSON) for `$varname`
references to build the dependency graph. A panel only re-queries when a
variable it references changes. **There is no separate declaration** — putting
`country: '$country'` anywhere in `options` is sufficient.

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

## Datasource Plugin

DashboardKit datasource plugins receive dashboard execution context because the
engine is orchestrating panel queries. Use `@loykin/datasourcekit` directly for
dashboard-independent alert, report, schema browser, query preview, or backend
job execution.

Datasources are optional. A dashboard can render static, derived, embedded, or
app-owned panels without registering any datasource plugin as long as those
panels do not declare `dataRequests[]`.

```ts
import { defineDatasource } from '@loykin/dashboardkit'

const datasource = defineDatasource<MyOptions, MyQuery>({
  uid: 'my-ds',
  type: 'my-type',
  options: { baseUrl: '/api' },
  cacheTtlMs: 30_000, // optional default cache TTL

  async queryData(request, context) {
    // DashboardKit does NOT interpolate queries — the datasource decides how
    // to use the raw query descriptor + resolved variables.
    const { variables, timeRange, datasourceOptions } = context
    return {
      columns: [{ name: 'ts', type: 'time' }, { name: 'value', type: 'number' }],
      rows: [[1704067200000, 42]],
    }
  },

  // Optional: streaming alternative to queryData()
  subscribeData(request, context, onData, onError) {
    const ws = openWebSocket(request, context)
    ws.onmessage = (e) => onData(JSON.parse(e.data))
    ws.onerror = (e) => onError(new Error(String(e)))
    return () => ws.close() // must return unsubscribe function
  },

  // Optional: used by `query`-type variables
  variable: {
    async metricFindQuery(query, context) {
      const items = await fetch(`/api/lookup?q=${query}`).then((r) => r.json())
      return items.map((v: string) => ({ label: v, value: v }))
    },
  },
})
```

Standalone DatasourceKit plugins use `queryData(request, context)` and do not
require `dashboardId`, `panelId`, or `requestId`:

```ts
import { createDatasourceExecutor, defineDatasource } from '@loykin/datasourcekit'

const datasource = defineDatasource({
  uid: 'main-api',
  type: 'backend',
  options: { baseUrl: '/api' },

  async queryData(request, context) {
    const res = await fetch(`${context.datasourceOptions.baseUrl}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: request.query,
        options: request.options,
        variables: context.variables,
        timeRange: context.timeRange,
      }),
      signal: context.signal,
    })
    return res.json()
  },
})

const executor = createDatasourceExecutor({ datasources: [datasource] })
const result = await executor.query(
  { id: 'preview', datasourceUid: 'main-api', query: 'orders.list' },
  { variables: { country: 'KR' }, meta: { source: 'query-preview' } },
)
```

`queryData()` receives:

```ts
interface DataQuery<TQuery> {
  id: string
  datasourceUid: string
  datasourceType?: string
  query?: TQuery           // dataRequest.query (raw)
  options?: Record<string, unknown>
}

interface DashboardDatasourceQueryContext<TOptions> {
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  datasourceOptions: TOptions
  signal?: AbortSignal
  dashboardId: string
  panelId: string
  requestId: string
}
```

Return value must be `QueryResult`:

```ts
interface QueryResult {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
  meta?: Record<string, unknown>
}
```

## Panel Plugin

```ts
import { definePanel, applyOptionDefaults } from '@loykin/dashboardkit'

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
    // results[0] is the first dataRequest result
    return results[0]?.rows.at(-1)?.[0] ?? null
  },
})

// Apply defaults when reading options in your React component
const options = applyOptionDefaults(statPanel.optionsSchema, panel.options)
```

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

const engine = createDashboardEngine({ stateStore, datasourcePlugins, panels, variableTypes })

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

// Lifecycle
engine.abortAll()   // cancel in-flight requests (keep engine alive)
engine.destroy()    // cancel requests + clear listeners + unsubscribe store

// Runtime registration (add plugins after creation)
engine.registerPanel(def)
engine.registerDatasource(def)
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

const datasource = defineDatasource({
  uid: 'postgres',
  type: 'postgres',
  async queryData(request, context) {
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
})
```

Built-in format specifiers: `csv`, `pipe`, `json`, `doublequote`, `singlequote`,
`sqlstring`, `sqlin`, `glob`, `regex`, `lucene`, `percentencode`, `text`, `raw`.

Syntax:
- `$varname` — default format
- `${varname:format}` — named format
- `$__timeFilter(col)` — built-in function (if registered in `functions`)

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
