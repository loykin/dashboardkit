import React from 'react'
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import { createBrowserDashboardStateStore } from '@loykin/dashboardkit/url-state'
import { DashboardGrid, useLoadDashboard, useVariable } from '@loykin/dashboardkit/react'
import type {
  DashboardInput,
  PanelPluginDef,
  QueryResult,
} from '@loykin/dashboardkit'
import type { PanelRenderProps } from '@loykin/dashboardkit/react'

const countries = ['KR', 'US', 'JP']

const tablePanel = definePanel({
  id: 'url-table',
  name: 'URL Table',
  optionsSchema: {},
  transform(results: QueryResult[]) {
    const result = results[0] ?? { columns: [], rows: [] }
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])),
    )
  },
})

const staticVariableType = defineVariableType({
  id: 'static',
  name: 'Static',
  optionsSchema: {},
  async resolve(config) {
    if (config.name === 'country') {
      return countries.map((value) => ({ label: value, value }))
    }
    const value = Array.isArray(config.defaultValue)
      ? config.defaultValue[0]
      : config.defaultValue
    return value ? [{ label: value, value }] : []
  },
})

const config: DashboardInput = {
  schemaVersion: 1,
  id: 'url-state-demo',
  title: 'URL State Demo',
  variables: [
    {
      name: 'country',
      type: 'static',
      defaultValue: 'KR',
      options: {},
    },
  ],
  timeRange: { from: 'now-6h', to: 'now' },
  panels: [
    {
      id: 'url-sales',
      type: 'url-table',
      title: 'URL Backed Sales',
      gridPos: { x: 0, y: 0, w: 12, h: 6 },
      dataRequests: [{ id: 'main', uid: 'url-state-backend', type: 'backend' }],
      options: {},
    },
  ],
  layout: { cols: 12, rowHeight: 36 },
}

export function UrlStateTab() {
  const [search, setSearch] = React.useState(window.location.search)
  const [lastQueryVars, setLastQueryVars] = React.useState<Record<string, string | string[]>>({})

  const stateStore = React.useMemo(() => createBrowserDashboardStateStore(), [])

  const engine = React.useMemo(() => {
    const datasource = defineDatasource({
      uid: 'url-state-backend',
      type: 'backend',
      async queryData(_request, {  variables, timeRange  }) {
        setLastQueryVars(variables)
        return {
          columns: [
            { name: 'country', type: 'string' },
            { name: 'from', type: 'string' },
            { name: 'to', type: 'string' },
            { name: 'amount', type: 'number' },
          ],
          rows: [[
            variables['country'] ?? 'KR',
            timeRange?.from ?? '',
            timeRange?.to ?? '',
            variables['country'] === 'US' ? 3200 : variables['country'] === 'JP' ? 2100 : 1200,
          ]],
        }
      },
    })

    return createDashboardEngine({
      stateStore,
      datasourcePlugins: [datasource],
      panels: [tablePanel] as PanelPluginDef[],
      variableTypes: [staticVariableType],
    })
  }, [stateStore, setLastQueryVars])

  useLoadDashboard(engine, config)

  React.useEffect(() => {
    const sync = () => setSearch(window.location.search)
    window.addEventListener('popstate', sync)
    const id = window.setInterval(sync, 200)
    sync()
    return () => {
      window.removeEventListener('popstate', sync)
      window.clearInterval(id)
    }
  }, [])

  return (
    <div className="space-y-4">
      <UrlControls engine={engine} stateStore={stateStore} search={search} />

      <DashboardGrid engine={engine} className="min-w-0">
        {(props) => <PanelShell {...props} />}
      </DashboardGrid>

      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-gray-700">Current URL Query</div>
        <pre className="overflow-auto rounded bg-gray-50 p-3 text-[11px] text-gray-700">
          {search || '(empty)'}
        </pre>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <StatePreview
          title="Raw URL Dashboard Variables"
          value={readUrlDashboardVariables(search)}
        />
        <StatePreview
          title="Datasource Query Variables"
          value={lastQueryVars}
        />
      </div>
    </div>
  )
}

function UrlControls({
  engine,
  stateStore,
  search,
}: {
  engine: ReturnType<typeof createDashboardEngine>
  stateStore: ReturnType<typeof createBrowserDashboardStateStore>
  search: string
}) {
  const country = useVariable(engine, 'country')

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
          Country
          <select
            className="rounded border border-gray-200 bg-white px-2 py-1 text-xs"
            value={Array.isArray(country.value) ? country.value[0] ?? '' : country.value}
            onChange={(event) => country.setValue(event.target.value)}
          >
            {countries.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => stateStore.setPatch({ timeRange: { from: 'now-1h', to: 'now' } })}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          Last 1h
        </button>
        <button
          onClick={() => stateStore.setPatch({ timeRange: { from: 'now-24h', to: 'now' } })}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          Last 24h
        </button>
        <button
          onClick={() => stateStore.setPatch({ refresh: '30s' })}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          30s Refresh
        </button>
        <button
          onClick={() => stateStore.setPatch({ refresh: '' })}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
        >
          No Refresh
        </button>
        <button
          onClick={() => {
            const params = new URLSearchParams(window.location.search)
            params.set('var-ghost', 'secret-city')
            params.set('auth-token', 'handoff-token')
            window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`)
            window.dispatchEvent(new PopStateEvent('popstate'))
            void engine.refreshAll()
          }}
          className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"
        >
          Inject Unknown Params
        </button>
      </div>
      <button
        onClick={() => {
          window.history.replaceState(window.history.state, '', window.location.pathname)
          window.dispatchEvent(new PopStateEvent('popstate'))
        }}
        className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
      >
        Clear URL State
      </button>
      <span className="max-w-full truncate text-[11px] text-gray-400">{search || '(empty)'}</span>
    </div>
  )
}

function readUrlDashboardVariables(search: string): Record<string, string | string[]> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const names = new Set<string>()
  params.forEach((_value, key) => {
    if (key.startsWith('var-')) names.add(key.slice(4))
  })

  const variables: Record<string, string | string[]> = {}
  for (const name of names) {
    const values = params.getAll(`var-${name}`)
    variables[name] = values.length === 1 ? values[0]! : values
  }
  return variables
}

function StatePreview({
  title,
  value,
}: {
  title: string
  value: unknown
}) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-gray-700">{title}</div>
      <pre className="min-h-24 overflow-auto rounded bg-gray-50 p-3 text-[11px] text-gray-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function PanelShell({ data, loading, error, ref }: PanelRenderProps) {
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className="flex h-full flex-col overflow-hidden rounded border border-gray-200 bg-white"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-700">URL Backed Sales</span>
        {loading && <span className="text-[10px] text-blue-500">loading</span>}
        {error && <span className="text-[10px] text-red-500">error</span>}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : (
          <pre className="rounded bg-gray-50 p-3 text-xs text-gray-700">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
