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
- **Structured requests**: panel queries use `dataRequests[]` with datasource
  identity, query descriptor, request options, permissions, and hide state
- **Variable engine**: dependency DAG, downstream refresh, include-all, sorting,
  readiness checks, and time-range refresh support
- **URL-safe state model**: variables, time range, and refresh can come from URL
  query params without pruning unknown app-owned query keys
- **Panel expansion**: repeat panels and row collapse are runtime expansions, not
  saved panel copies
- **Panel query cache**: panel-scoped cache with targeted invalidation
- **Authorization hook**: block panel, variable, and datasource queries before a
  datasource plugin runs
- **React adapter**: `DashboardGrid`, hooks, draft editor helpers, and URL state
  adapter are optional entrypoints
- **ESM + CJS**: ships import and require builds with declarations

## Installation

```bash
pnpm add @loykin/dashboardkit
```

React rendering helpers are optional but require these peer dependencies:

```bash
pnpm add react react-dom react-grid-layout
```

`zod` and `zustand` are regular package dependencies and do not need to be
installed separately by consumers.

## Package Entrypoints

```ts
import { createDashboardEngine } from '@loykin/dashboardkit'
import { DashboardGrid } from '@loykin/dashboardkit/react'
import { createBrowserDashboardStateStore } from '@loykin/dashboardkit/url-state'
```

## Core Model

DashboardKit has two different kinds of state:

- **Dashboard config**: panels, variables, layout, links, permissions, defaults.
  After `engine.load(config)`, this is owned by the engine and can be mutated
  through engine CRUD APIs.
- **Dashboard input state**: selected variable values, time range, and refresh
  interval. This lives in a `DashboardStateStore`, which can be memory-backed,
  URL-backed, or app-provided.

Unknown external query/state keys are preserved. A dashboard variable named
`country` may read/write `var-country`, but the library must not delete unrelated
keys such as `auth-token`, router params, or app-specific flags.

## Quick Start

```tsx
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
} from '@loykin/dashboardkit'
import { DashboardGrid, useLoadDashboard } from '@loykin/dashboardkit/react'

const datasource = defineDatasource({
  uid: 'main-api',
  type: 'backend',
  options: { baseUrl: '/api' },
  async query({ dashboardId, panelId, requestId, query, variables, timeRange, datasourceOptions }) {
    const response = await fetch(`${datasourceOptions.baseUrl}/dashboards/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardId, panelId, requestId, query, variables, timeRange }),
    })
    return response.json()
  },
})

const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  transform(results) {
    return results[0]?.rows ?? []
  },
})

const engine = createDashboardEngine({
  datasourcePlugins: [datasource],
  panels: [tablePanel],
  variableTypes: [],
})

const dashboard = {
  schemaVersion: 1 as const,
  id: 'sales',
  title: 'Sales',
  panels: [
    {
      id: 'orders',
      type: 'table',
      title: 'Orders',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      dataRequests: [
        { id: 'main', uid: 'main-api', type: 'backend', query: 'orders.list' },
      ],
    },
  ],
}

export function DashboardPage() {
  useLoadDashboard(engine, dashboard)

  return (
    <DashboardGrid engine={engine}>
      {({ config, data, loading, error }) => {
        if (loading) return <div>Loading</div>
        if (error) return <div>{error}</div>
        return (
          <section>
            <h2>{config.title}</h2>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </section>
        )
      }}
    </DashboardGrid>
  )
}
```

`DashboardGrid` reads layout and runtime panel instances from the engine. Do not
pass the same config back into the grid as a prop.

## Builder Flow

Use engine APIs for committed dashboard config mutations:

```ts
await engine.addPanel({
  id: 'latency',
  type: 'stat',
  title: 'Latency',
  gridPos: { x: 0, y: 0, w: 6, h: 4 },
  dataRequests: [{ id: 'main', uid: 'main-api', type: 'backend', query: 'latency.p95' }],
})

await engine.updatePanel('latency', {
  title: 'P95 latency',
  options: { unit: 'ms' },
})

await engine.addVariable({
  name: 'country',
  type: 'static',
  defaultValue: 'KR',
  options: { values: ['KR', 'US'] },
})

await engine.updateVariable('country', {
  label: 'Country',
  defaultValue: 'US',
})

await engine.updateDashboard({
  title: 'Production dashboard',
  tags: ['prod', 'ops'],
})

const configToSave = engine.getConfig()
```

Save `configToSave` in your app/backend. Reload it later with
`engine.load(configToSave)`.

Structural rules:

- `updatePanel()` cannot change a panel id.
- Runtime repeat instance ids are not accepted by panel CRUD APIs; edit the
  origin panel id.
- `updateVariable()` cannot rename a variable. Renaming needs an explicit
  migration of all references.
- `updateDashboard()` does not replace `id`, `schemaVersion`, `panels`, or
  `variables`; use the dedicated APIs for those structures.

## Datasource Responsibility

DashboardKit does not automatically mutate query strings before calling a
datasource. It passes both:

- the original request descriptor: `query`, `requestOptions`, `dataRequest`
- resolved variables: `variables`

Datasource plugins decide how to use them.

```ts
const datasource = defineDatasource({
  uid: 'metrics',
  type: 'prometheus',
  async query({ query, variables }) {
    const raw = String(query ?? '')
    const expression = raw.replace(/\$job/g, String(variables.job ?? ''))
    return runPrometheusQuery(expression)
  },
})
```

This is intentional. SQL, PromQL, HTTP parameters, and backend query ids all need
different binding rules. For secure dashboards, prefer sending `dashboardId`,
`panelId`, `requestId`, `variables`, and `timeRange` to your backend and building
executable SQL/PromQL server-side.

## State Store And URL State

```ts
import { createBrowserDashboardStateStore } from '@loykin/dashboardkit/url-state'

const stateStore = createBrowserDashboardStateStore()

const engine = createDashboardEngine({
  stateStore,
  datasourcePlugins,
  panels,
  variableTypes,
})

engine.load(config, { statePolicy: 'replace-dashboard-variables' })

engine.setVariable('country', 'KR')
engine.setTimeRange({ from: 'now-6h', to: 'now' })
engine.setRefresh('30s')
```

The URL state adapter only owns dashboard state keys. Unknown URL query params
are preserved.

## API Overview

### Engine

```ts
engine.load(config, options?)
engine.getConfig()

engine.addPanel(panel, options?)
engine.updatePanel(panelId, patch, options?)
engine.removePanel(panelId, options?)
engine.previewPanel(panelId, tempPanel, options?)
engine.previewDataRequest(request, options?)

engine.addVariable(variable, options?)
engine.updateVariable(name, patch, options?)
engine.removeVariable(name, options?)
engine.setVariable(name, value)
engine.refreshVariable(name)
engine.refreshVariables()
engine.getVariableReadiness(names)

engine.updateDashboard(patch, options?)

engine.setTimeRange(range)
engine.setRefresh(refresh)
engine.refreshPanel(panelId)
engine.refreshAll()

engine.setPanelSelection(panelId, filters)
engine.clearPanelSelection(panelId)
engine.clearAllPanelSelections()

engine.subscribe(listener)
```

### React Hooks

```ts
useLoadDashboard(engine, config, options?)
useDashboard(engine)
usePanel(engine, panelId)
useVariable(engine, name)
useEngineEvent(engine, handler)
useConfigChanged(engine, handler)

usePanelDraftEditor(engine, panelId)
useVariableEditor(engine, name)
useOptionsChange(options, onOptionsChange)
useImeInput(initialValue)
```

`usePanelDraftEditor()` keeps uncommitted editor state separate from the engine
config. Use `previewPanel()` for previews and `updatePanel()` to commit.

## Plugin Definitions

### Datasource

```ts
const datasource = defineDatasource({
  uid: 'main-api',
  type: 'backend',
  options: { baseUrl: '/api' },
  async query(options) {
    return {
      columns: [{ name: 'value', type: 'number' }],
      rows: [[1]],
    }
  },
})
```

### Panel

```ts
import { applyOptionDefaults, definePanel } from '@loykin/dashboardkit'

const statPanel = definePanel({
  id: 'stat',
  name: 'Stat',
  optionsSchema: {
    title: { type: 'string', label: 'Title', required: true },
    unit: { type: 'string', label: 'Unit', default: 'short' },
  },
  transform(results) {
    return results[0]?.rows.at(-1)?.[0] ?? null
  },
})

const options = applyOptionDefaults(statPanel.optionsSchema, panelConfig.options)
```

Option schemas support `string`, `number`, `boolean`, `select`, `multiselect`,
`color`, `json`, and `array` fields. Validation metadata includes `required`,
`default`, `min`, `max`, `integer`, `minLength`, `maxLength`, `pattern`,
`choices`, `items`, `minItems`, `maxItems`, and custom `validate()`.

### Variable Type

```ts
import { defineVariableType } from '@loykin/dashboardkit'

const staticVariable = defineVariableType<{ values?: string[] }>({
  id: 'static',
  name: 'Static',
  optionsSchema: {},
  async resolve(config, options) {
    const values = Array.isArray(options.values) ? options.values : []
    return values.map((value) => ({ label: value, value }))
  },
})
```

## Dashboard Config

`DashboardInput` accepts omitted defaults. `DashboardConfig` is the parsed output
with defaults filled.

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

`schemaVersion` is this library's dashboard schema version. It is currently
`1`.

## Authorization

```ts
const engine = createDashboardEngine({
  datasourcePlugins,
  panels,
  variableTypes,
  authContext: { subject: { id: 'user-1', roles: ['viewer'] } },
  authorize(request) {
    if (request.action === 'datasource:query') {
      return { allowed: true }
    }
    return true
  },
})
```

Authorization runs before datasource calls for panel queries, variable queries,
and preview requests.

## Playground

The playground lives in `playground/`.

```bash
pnpm dev
```

Primary examples:

- `?tab=navigation-lifecycle`: builder lifecycle, config CRUD, save with
  `getConfig()`, reload saved config, and dashboard navigation
- `?tab=grafana-style`: operations viewer, variables, time range, row panels,
  editable grid, and panel inspector
- `?tab=superset-style`: exploration workflow with chart cross-filtering and
  preview/edit sync
- `?tab=url-state`: URL-backed dashboard state store

## Development

```bash
pnpm type-check
pnpm test
pnpm build
pnpm pack --dry-run
```

## License

MIT
