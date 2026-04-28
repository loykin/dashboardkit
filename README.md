# @dashboard-engine/core

A headless dashboard orchestration engine inspired by Grafana — pure TypeScript, no framework opinion.

## Features

- **Headless** — No styles included. You own the layout and panel UI
- **Plugin-based** — Register Datasource, Panel, and VariableType plugins to extend functionality
- **Grafana-style schema** — Familiar structures: `gridPos`, `targets[]`, `fieldConfig`
- **Variable interpolation** — `$varName` / `${varName}` syntax with DAG-based dependency ordering
- **Query caching** — Per-panel result cache; automatically invalidated on time range or variable change
- **Authorization hook** — Block datasource queries before the plugin sends anything to the backend
- **Viewport virtualization** — `usePanel` uses IntersectionObserver to skip off-screen panel queries
- **Dual ESM + CJS** — Ships both `dist/index.js` (ESM) and `dist/index.cjs` (CJS)

## Installation

```bash
pnpm add @dashboard-engine/core
# peer dependencies
pnpm add react react-dom react-grid-layout zod zustand
```

## Quick Start

```tsx
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  useDashboard,
  usePanel,
  DashboardGrid,
} from '@dashboard-engine/core'

// 1. Define plugins
const myDs = defineDatasource({
  uid: 'my-api',
  options: { baseUrl: 'https://api.example.com' },
  async query({ dashboardId, panelId, refId, variables, timeRange, datasourceOptions }) {
    const res = await fetch(`${datasourceOptions.baseUrl}/dashboards/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardId, panelId, refId, variables, timeRange }),
    })
    return res.json()
  },
})

const TablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  component: ({ data, loading }) =>
    loading ? <p>Loading…</p> : <pre>{JSON.stringify(data, null, 2)}</pre>,
})

// 2. Create engine instance
const engine = createDashboardEngine({
  datasources: [myDs],
  panels: [TablePanel],
  variableTypes: [],
  authContext: {
    subject: { id: 'user-1', roles: ['viewer'] },
  },
  authorize({ action, authContext }) {
    if (action === 'datasource:query' && authContext.subject?.roles?.includes('viewer')) {
      return { allowed: false, reason: 'viewer cannot query this datasource' }
    }
    return true
  },
})

// 3. Define dashboard config
const config = {
  schemaVersion: 1 as const,
  title: 'My Dashboard',
  id: 'my-dashboard',
  layout: { cols: 24, rowHeight: 30 },
  timeRange: { from: 'now-1h', to: 'now' },
  variables: [],
  panels: [
    {
      id: 'panel-1',
      title: 'Users',
      type: 'table',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      targets: [
        {
          refId: 'A',
          datasource: { uid: 'my-api', type: 'mock' },
        },
      ],
    },
  ],
}

// 4. React component
function MyDashboard() {
  const { setVariable } = useDashboard(engine, config)

  return (
    <DashboardGrid
      engine={engine}
      renderPanel={(panel, { width, height }) => {
        const { data, loading, error } = usePanel(engine, panel.id)
        return (
          <TablePanel
            options={panel.options}
            data={data}
            loading={loading}
            error={error}
            width={width}
            height={height}
            rawData={null}
          />
        )
      }}
    />
  )
}
```

## Architecture

```
Dashboard App (user code)
│
├── DashboardConfig          ← JSON-serializable schema (Zod-validated)
│   ├── panels[].gridPos     ← Layout position (Grafana gridPos style)
│   ├── panels[].targets[]   ← Query targets (extended by datasource plugins)
│   └── variables[]          ← Variable configuration
│
├── createDashboardEngine()  ← Engine instance factory
│   ├── datasources[]        ← DatasourcePluginDef (uid-keyed)
│   ├── panels[]             ← PanelPluginDef
│   └── variableTypes[]      ← VariableTypePluginDef
│
├── React Hooks              ← Provided by this library
│   ├── useDashboard()       ← Full state (variables, time range)
│   ├── usePanel()           ← Panel data + loading state
│   ├── useVariable()        ← Single variable subscription
│   └── useEngineEvent()     ← Engine event subscription
│
└── DashboardGrid            ← react-grid-layout v2 wrapper (drag & resize)
```

## Plugin Boundary

| Concern | Library | Plugin / App |
|---------|---------|--------------|
| Target fields | `refId`, `datasource`, `hide` | All other fields (`query`, `expr`, `rawSql`, …) |
| Variable interpolation | `$var` token parsing, DAG ordering | Actual interpolation (via `interpolate()` utility) |
| Data transformation | `QueryResult` type definition | `PanelPluginDef.transform()` |
| Styling | None | You decide |

## API

### `createDashboardEngine(options)`

| Option | Type | Description |
|--------|------|-------------|
| `datasources` | `DatasourcePluginDef[]` | Datasource plugin instances |
| `panels` | `PanelPluginDef[]` | Panel plugin definitions |
| `variableTypes` | `VariableTypePluginDef[]` | Variable type plugins |
| `builtinVariables` | `BuiltinVariable[]?` | Override built-in variables |
| `stateStore` | `DashboardStateStore?` | Canonical dashboard input state store |
| `authContext` | `AuthContext?` | Current user/tenant context used by authorization |
| `authorize` | `(request) => boolean \| AuthorizationDecision` | Called before datasource queries |

### `DashboardStateStore`

Dashboard input state is read and written through one canonical store. Runtime
state such as panel data, loading flags, resolved variable options, and query
cache remains internal and derived from this snapshot.

```ts
interface DashboardStateSnapshot {
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  refresh?: string
}

interface DashboardStateStore {
  getSnapshot(): DashboardStateSnapshot
  setPatch(patch: DashboardStatePatch, options?: { replace?: boolean }): void
  subscribe(listener: (snapshot: DashboardStateSnapshot) => void): () => void
}
```

Use `createMemoryDashboardStateStore()` for local state, or provide a custom
implementation backed by URL query params, router state, or another persistence
mechanism.

### `defineDatasource(def)`

```ts
interface DatasourcePluginDef<TOptions> {
  uid: string                      // Matches target.datasource.uid in config
  options?: TOptions               // Infrastructure config (URL, auth, etc.)
  query(options: QueryOptions<TOptions>): Promise<QueryResult>
  metricFindQuery?(query, vars): Promise<VariableOption[]>
}
```

### `QueryOptions<TOptions>`

```ts
interface QueryOptions<TOptions> {
  target: Record<string, unknown>  // Plugin-defined query fields (passthrough)
  dashboardId: string
  panelId: string
  refId: string
  variables: Record<string, string | string[]>
  datasourceOptions: TOptions
  authContext?: AuthContext
  timeRange?: { from: string; to: string }
  maxDataPoints?: number
}
```

For secure dashboards, keep executable query text out of the browser config. Use
`dashboardId`, `panelId`, `refId`, `variables`, and `timeRange` as the backend
request payload, then build SQL/PromQL/etc. on the backend after server-side
authorization.

### `QueryResult`

```ts
interface QueryResult {
  columns: string[]
  rows: unknown[][]
  refId?: string
  meta?: Record<string, unknown>
}
```

### `definePanel(def)` and Panel Options

`definePanel` accepts a `TOptions` generic to type-check per-panel configuration.

```ts
import { definePanel, applyOptionDefaults } from '@dashboard-engine/core'
import type { OptionSchema } from '@dashboard-engine/core'

interface StatOptions {
  thresholdWarn: number
  thresholdCrit: number
  colorOk: string
}

const statOptionsSchema: OptionSchema = {
  thresholdWarn: { type: 'number', label: 'Warning threshold', default: 80, min: 0, max: 100 },
  thresholdCrit: { type: 'number', label: 'Critical threshold', default: 95, min: 0, max: 100 },
  colorOk:       { type: 'color',  label: 'OK color',           default: '#22c55e' },
}

const StatPanel = definePanel<StatOptions>({
  id: 'stat',
  name: 'Stat Panel',
  optionsSchema: statOptionsSchema,
  component: ({ options, data }) => {
    const opts = applyOptionDefaults(statOptionsSchema, options) as StatOptions
    const color = data >= opts.thresholdCrit ? 'red'
                : data >= opts.thresholdWarn ? 'orange'
                : opts.colorOk
    return <div style={{ color }}>{data}</div>
  },
})
```

Then set per-panel values in `DashboardConfig`. Any field omitted here falls back to the `default` declared in `optionsSchema`:

```ts
panels: [
  {
    id: 'panel-1',
    type: 'stat',       // matches StatPanel.id
    options: {
      thresholdWarn: 70,
      thresholdCrit: 90,
      // colorOk omitted → applyOptionDefaults injects '#22c55e'
    },
    // ...
  },
]
```

`OptionField` types: `string` | `number` | `boolean` | `select` | `multiselect` | `color` | `json` | `array`

### `DashboardConfig`

```ts
interface DashboardConfig {
  schemaVersion: 1         // Must be exactly 1 (Zod literal — increment when schema changes)
  title: string
  description?: string
  layout: { cols: number; rowHeight: number }
  timeRange: { from: string; to: string }
  refresh?: string
  tags?: string[]
  variables: VariableConfig[]
  panels: PanelConfig[]
  links?: DashboardLink[]
}
```

> `schemaVersion` is a Zod `literal(1)` — this library's own schema version, starting at 1 (unrelated to Grafana). It will be incremented as an integer when a breaking schema change is introduced.

### Hooks

```ts
useDashboard(engine, config): { variables, timeRange, setVariable, setTimeRange, refreshAll }
usePanel(engine, panelId):    { data, loading, error, state }
useVariable(engine, name):    VariableState | undefined
useEngineEvent(engine, handler): void
```

## Utilities

```ts
import { interpolate, parseRefs, format } from '@dashboard-engine/core'

// Variable interpolation
interpolate('Hello $name!', { name: 'World' })
// → 'Hello World!'

// Parse variable references from a string
parseRefs('SELECT * FROM $table WHERE $col = 1')
// → ['table', 'col']

// Value formatting
format(1234567, 'bytes')    // → '1.18 MB'
format(0.9523, 'percent')   // → '95.23%'
```

## Development

```bash
# Build (type-check + tsup)
pnpm build

# Dev mode (library watch + playground dev server)
pnpm dev

# Type-check only
pnpm type-check
```

The playground lives in the `playground/` directory and runs on Vite + Tailwind v4.

## License

MIT
