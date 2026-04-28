import React from 'react'
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
  interpolate,
} from '@dashboard-engine/core'
import {
  DashboardGrid,
  useDashboard,
  useVariable,
} from '@dashboard-engine/core/react'
import type { DashboardInput, QueryResult, PanelPluginDef } from '@dashboard-engine/core'
import type { PanelRenderProps } from '@dashboard-engine/core/react'

// ─── Mock Datasource ───────────────────────────────────────────────────────────
// In production, call the backend with fetch(). Here we return in-memory data.

const SALES_DATA: Record<string, { time: string; amount: number; city: string }[]> = {
  KR: [
    { time: '2024-01-01', amount: 1200, city: 'seoul' },
    { time: '2024-01-02', amount: 980, city: 'seoul' },
    { time: '2024-01-03', amount: 1450, city: 'busan' },
    { time: '2024-01-04', amount: 870, city: 'busan' },
    { time: '2024-01-05', amount: 1600, city: 'seoul' },
  ],
  US: [
    { time: '2024-01-01', amount: 3200, city: 'newyork' },
    { time: '2024-01-02', amount: 2800, city: 'newyork' },
    { time: '2024-01-03', amount: 4100, city: 'la' },
    { time: '2024-01-04', amount: 3700, city: 'la' },
    { time: '2024-01-05', amount: 2900, city: 'newyork' },
  ],
  JP: [
    { time: '2024-01-01', amount: 2100, city: 'tokyo' },
    { time: '2024-01-02', amount: 1800, city: 'osaka' },
    { time: '2024-01-03', amount: 2400, city: 'tokyo' },
    { time: '2024-01-04', amount: 1950, city: 'osaka' },
    { time: '2024-01-05', amount: 2700, city: 'tokyo' },
  ],
}

const CITIES: Record<string, string[]> = {
  KR: ['seoul', 'busan', 'daegu'],
  US: ['newyork', 'la', 'chicago'],
  JP: ['tokyo', 'osaka', 'kyoto'],
}

const mockDs = defineDatasource({
  uid: 'mock',
  type: 'mock',
  async query({ query: rawQuery = '', variables }) {
    // Interpolation is also the plugin's responsibility — substitute using variables from the library
    const interpolatedQuery = interpolate(String(rawQuery), { variables, builtins: {}, functions: {} })

    await new Promise((r) => setTimeout(r, 300 + Math.random() * 200))

    const country = (variables['country'] as string) ?? 'KR'
    const city = variables['city'] as string | undefined
    const rows = (SALES_DATA[country] ?? []).filter((r) =>
      city && city !== '' ? r.city === city : true,
    )

    if (interpolatedQuery.includes('DISTINCT country')) {
      return {
        columns: [{ name: 'country', type: 'string' }],
        rows: ['KR', 'US', 'JP'].map((c) => [c]),
      }
    }

    if (interpolatedQuery.includes('FROM cities')) {
      const cities = CITIES[country] ?? []
      return {
        columns: [{ name: 'city', type: 'string' }],
        rows: cities.map((c) => [c]),
      }
    }

    return {
      columns: [
        { name: 'time', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'city', type: 'string' },
      ],
      rows: rows.map((r) => [r.time, r.amount, r.city]),
    }
  },
  async metricFindQuery(query, vars) {
    const country = (vars['country'] as string) ?? 'KR'
    if (query.includes('DISTINCT country')) {
      return ['KR', 'US', 'JP'].map((v) => ({ label: v, value: v }))
    }
    if (query.includes('FROM cities')) {
      return (CITIES[country] ?? []).map((c) => ({ label: c, value: c }))
    }
    return []
  },
})

// ─── Variable Types ────────────────────────────────────────────────────────────

const queryVarType = defineVariableType({
  id: 'query',
  name: 'Query Variable',
  optionsSchema: {},
  async resolve(config, _options, ctx) {
    const request = config.dataRequest
    const ds = request ? ctx.datasourcePlugins[request.uid] : undefined
    if (!request?.query || !ds?.metricFindQuery) return []

    // Substitute variables in query
    const interpolated = interpolate(String(request.query), {
      variables: ctx.variables,
      builtins: ctx.builtins,
      functions: {},
    })
    return ds.metricFindQuery(interpolated, Object.fromEntries(
      Object.entries(ctx.variables).map(([k, v]) => [k, v]),
    ))
  },
})

// ─── Panel Definitions ────────────────────────────────────────────────────────

function toRows(result: QueryResult) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]])),
  ) as Record<string, unknown>[]
}

const tablePanel = definePanel({
  id: 'table',
  name: 'Table Panel',
  optionsSchema: {},
  transform: (results) => toRows(results[0] ?? { columns: [], rows: [] }),
})

const statPanel = definePanel({
  id: 'stat',
  name: 'Stat Panel',
  optionsSchema: {},
  transform: (results) => {
    const result = results[0] ?? { columns: [], rows: [] }
    const rows = toRows(result)
    const total = rows.reduce((sum, r) => sum + ((r['amount'] as number) ?? 0), 0)
    return { total, count: rows.length }
  },
})

// ─── Engine (singleton created at module scope) ────────────────────────────────

const engine = createDashboardEngine({
  datasourcePlugins: [mockDs],
  panels: [tablePanel, statPanel] as PanelPluginDef[],
  variableTypes: [queryVarType],
})

// ─── Dashboard Config ─────────────────────────────────────────────────────────

const config: DashboardInput = {
  schemaVersion: 1,
  id: 'sales-demo',
  title: 'Sales Demo Dashboard',
  description: 'Mock data-based demo',
  tags: [],
  variables: [
    {
      name: 'country',
      type: 'query',
      label: 'Country',
      dataRequest: {
        id: 'options',
        uid: 'mock',
        type: 'mock',
        query: 'SELECT DISTINCT country FROM sales',
      },
      defaultValue: 'KR',
      multi: false,
      options: {},
    },
    {
      name: 'city',
      type: 'query',
      label: 'City',
      dataRequest: {
        id: 'options',
        uid: 'mock',
        type: 'mock',
        query: "SELECT city FROM cities WHERE country = '$country'",
      },
      defaultValue: null,
      multi: false,
      options: {},
    },
  ],
  panels: [
    {
      id: 'stat-total',
      type: 'stat',
      title: 'Total Sales — $country',
      gridPos: { x: 0, y: 0, w: 8, h: 3 },
      dataRequests: [{ id: 'main', uid: 'mock', type: 'mock', query: "SELECT * FROM sales WHERE country = '$country'" }],
      options: {},
    },
    {
      id: 'stat-city',
      type: 'stat',
      title: '$city Sales',
      gridPos: { x: 8, y: 0, w: 8, h: 3 },
      dataRequests: [{ id: 'main', uid: 'mock', type: 'mock', query: "SELECT * FROM sales WHERE country = '$country' AND city = '$city'" }],
      options: {},
    },
    {
      id: 'table-main',
      type: 'table',
      title: 'Sales Table',
      gridPos: { x: 0, y: 3, w: 24, h: 7 },
      dataRequests: [{ id: 'main', uid: 'mock', type: 'mock', query: "SELECT * FROM sales WHERE country = '$country' AND city = '$city'" }],
      options: {},
    },
  ],
  layout: { cols: 24, rowHeight: 30 },
}

// ─── Panel Renderer ───────────────────────────────────────────────────────────

function PanelShell({ panelId, panelType, data, loading, error, ref }: PanelRenderProps) {
  const pcfg = config.panels.find((p) => p.id === panelId)!
  const { variables } = useDashboard(engine, config)

  // Substitute variables in title
  const title = (pcfg.title ?? '').replace(/\$(\w+)/g, (_, name) => {
    const v = variables[name]?.value
    return Array.isArray(v) ? v.join(', ') : (v as string) ?? `$${name}`
  })

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className="h-full flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm"
    >
      {/* Panel header */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold text-gray-700 truncate">{title}</span>
        {loading && (
          <span className="ml-auto text-[10px] text-blue-500 animate-pulse shrink-0">loading…</span>
        )}
        {error && <span className="ml-auto text-[10px] text-red-500 shrink-0">error</span>}
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-auto p-3 min-h-0">
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : panelType === 'stat' ? (
          <StatBody data={data as { total: number; count: number } | null} />
        ) : panelType === 'table' ? (
          <TableBody data={data as Record<string, unknown>[] | null} />
        ) : null}
      </div>
    </div>
  )
}

function StatBody({ data }: { data: { total: number; count: number } | null }) {
  if (!data) return <p className="text-xs text-gray-400">No data</p>
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <span className="text-3xl font-bold text-gray-900">
        {data.total.toLocaleString()}
      </span>
      <span className="text-xs text-gray-400">{data.count} rows</span>
    </div>
  )
}

function TableBody({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data || data.length === 0) return <p className="text-xs text-gray-400">No data</p>
  const cols = Object.keys(data[0]!)
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-gray-50">
        <tr>
          {cols.map((c) => (
            <th key={c} className="px-2 py-1 text-left text-gray-500 font-medium capitalize">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {data.map((row, i) => (
          <tr key={i} className="hover:bg-gray-50">
            {cols.map((c) => (
              <td key={c} className="px-2 py-1.5 text-gray-800">
                {String(row[c] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Variable Bar ─────────────────────────────────────────────────────────────

function VariableBar() {
  const country = useVariable(engine, 'country')
  const city = useVariable(engine, 'city')

  return (
    <div className="flex flex-wrap items-center gap-4 p-3 bg-gray-50 border-b border-gray-200 text-xs">
      <VariableSelect label="Country" variable={country} />
      <VariableSelect label="City" variable={city} />
    </div>
  )
}

function VariableSelect({
  label,
  variable,
}: {
  label: string
  variable: ReturnType<typeof useVariable>
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 font-medium">{label}</span>
      {variable.loading ? (
        <span className="text-gray-400 animate-pulse">loading…</span>
      ) : (
        <select
          className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={Array.isArray(variable.value) ? variable.value[0] ?? '' : variable.value}
          onChange={(e) => variable.setValue(e.target.value)}
        >
          {variable.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function DashboardDemoTab() {
  const [editable, setEditable] = React.useState(false)

  return (
    <div className="space-y-0 -mx-8 -mt-6">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4">
        <VariableBar />
        <button
          onClick={() => setEditable((v) => !v)}
          className={`shrink-0 rounded px-3 py-1 text-xs font-medium transition-colors ${
            editable
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
          }`}
        >
          {editable ? '✓ Editing' : 'Edit'}
        </button>
      </div>
      <div className="px-4 py-4">
        <DashboardGrid
          engine={engine}
          config={config}
          editable={editable}
          className="w-full"
        >
          {(props) => <PanelShell {...props} />}
        </DashboardGrid>
      </div>
    </div>
  )
}
