import { useEffect, useMemo, useState } from 'react'
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@dashboard-engine/core'
import { DashboardGrid, useConfigChanged, useLoadDashboard, usePanelDraftEditor, useVariable } from '@dashboard-engine/core/react'
import type { CoreEngineAPI, DashboardInput, QueryOptions, QueryResult } from '@dashboard-engine/core'
import type { PanelRenderProps } from '@dashboard-engine/core/react'

interface SeriesRow {
  time: string
  value: number
  host: string
}

const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {
    title: { type: 'string', label: 'Title', required: true },
    unit: { type: 'string', label: 'Unit' },
  },
  transform(results: QueryResult[]) {
    return results.flatMap((result) => result.rows) as unknown[][]
  },
})

const statPanel = definePanel({
  id: 'stat',
  name: 'Stat',
  optionsSchema: {
    title: { type: 'string', label: 'Title', required: true },
  },
  transform(results: QueryResult[]) {
    const rows = results[0]?.rows ?? []
    const latest = rows.at(-1)?.[1]
    return typeof latest === 'number' ? latest : null
  },
})

const rowPanel = definePanel({ id: 'row', name: 'Row', optionsSchema: {} })

const optionVariable = defineVariableType({
  id: 'options',
  name: 'Options',
  optionsSchema: {},
  async resolve(_config, options) {
    const values = Array.isArray((options as Record<string, unknown>).values)
      ? (options as Record<string, string[]>).values
      : []
    return values.map((value) => ({ label: value, value }))
  },
})

function sampleRows(options: QueryOptions): SeriesRow[] {
  const env = String(options.variables.env ?? 'prod')
  const hostValue = options.variables.host
  const host = Array.isArray(hostValue) ? hostValue.join(', ') : String(hostValue ?? 'api-1')
  const base = env === 'prod' ? 72 : 38
  return Array.from({ length: 8 }, (_, index) => ({
    time: `T-${7 - index}`,
    value: Math.round(base + Math.sin(index) * 9 + index * 2),
    host,
  }))
}

const datasource = defineDatasource({
  uid: 'metrics',
  type: 'metrics',
  async query(options) {
    const rows = sampleRows(options)
    return {
      columns: [
        { name: 'time', type: 'time' },
        { name: 'value', type: 'number' },
        { name: 'host', type: 'string' },
      ],
      rows: rows.map((row) => [row.time, row.value, row.host]),
      meta: { query: options.query, timeRange: options.timeRange },
    }
  },
})

const dashboard: DashboardInput = {
  schemaVersion: 1,
  id: 'grafana-style',
  title: 'Operations',
  layout: { cols: 24, rowHeight: 32 },
  timeRange: { from: 'now-6h', to: 'now' },
  refresh: '30s',
  variables: [
    {
      name: 'env',
      type: 'options',
      defaultValue: 'prod',
      options: { values: ['prod', 'staging'] },
    },
    {
      name: 'host',
      type: 'options',
      defaultValue: 'api-1',
      options: { values: ['api-1', 'api-2', 'worker-1'] },
    },
  ],
  panels: [
    {
      id: 'row-overview',
      type: 'row',
      title: 'Overview',
      isRow: true,
      gridPos: { x: 0, y: 0, w: 24, h: 1 },
    },
    {
      id: 'cpu-stat',
      type: 'stat',
      title: 'CPU latest',
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
      options: { title: 'CPU latest' },
      dataRequests: [{ id: 'main', uid: 'metrics', type: 'metrics', query: 'cpu.load' }],
    },
    {
      id: 'memory-stat',
      type: 'stat',
      title: 'Memory latest',
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
      options: { title: 'Memory latest' },
      dataRequests: [{ id: 'main', uid: 'metrics', type: 'metrics', query: 'memory.used' }],
    },
    {
      id: 'series-table',
      type: 'table',
      title: '$env metrics on $host',
      gridPos: { x: 0, y: 5, w: 12, h: 7 },
      options: { title: 'Recent samples', unit: '%' },
      dataRequests: [{ id: 'main', uid: 'metrics', type: 'metrics', query: 'timeseries.samples' }],
    },
  ],
}

function Toolbar({ engine }: { engine: CoreEngineAPI }) {
  const env = useVariable(engine, 'env')
  const host = useVariable(engine, 'host')

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <label className="text-xs font-medium text-gray-600">
        Env
        <select
          className="ml-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          value={String(env.value)}
          onChange={(event) => env.setValue(event.target.value)}
        >
          {env.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="text-xs font-medium text-gray-600">
        Host
        <select
          className="ml-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          value={String(host.value)}
          onChange={(event) => host.setValue(event.target.value)}
        >
          {host.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <button
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
        onClick={() => engine.setTimeRange({ from: 'now-1h', to: 'now' })}
      >
        Last 1h
      </button>
      <button
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
        onClick={() => engine.setTimeRange({ from: 'now-24h', to: 'now' })}
      >
        Last 24h
      </button>
      <button className="rounded bg-gray-900 px-2 py-1 text-xs text-white" onClick={() => void engine.refreshAll()}>
        Refresh
      </button>
    </div>
  )
}

function renderPanel(props: PanelRenderProps) {
  if (props.instance.isRow) {
    return (
      <div className="flex h-full w-full items-center justify-between rounded border border-gray-300 bg-gray-100 px-3 text-left text-sm font-semibold">
        {props.config.title}
      </div>
    )
  }

  if (props.loading) return <div className="p-3 text-xs text-gray-500">Loading</div>
  if (props.error) return <div className="p-3 text-xs text-red-600">{props.error}</div>

  if (props.panelType === 'stat') {
    return (
      <div className="flex h-full flex-col justify-between rounded border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase text-gray-500">{props.config.title}</div>
        <div className="text-4xl font-semibold">{String(props.data ?? '-')}</div>
      </div>
    )
  }

  const rows = Array.isArray(props.data) ? props.data : []
  return (
    <div className="h-full overflow-hidden rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-3 py-2 text-sm font-semibold">{props.config.title}</div>
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.slice(0, 6).map((row, index) => (
            <tr key={index} className="border-b border-gray-100">
              <td className="px-3 py-2 text-gray-500">{String(row[0])}</td>
              <td className="px-3 py-2 font-medium">{String(row[1])}</td>
              <td className="px-3 py-2 text-gray-500">{String(row[2])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function GrafanaStyleTab() {
  const engine = useMemo(() => createDashboardEngine({
    panels: [tablePanel, statPanel, rowPanel],
    datasourcePlugins: [datasource],
    variableTypes: [optionVariable],
  }), [])
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>('cpu-stat')
  const [editable, setEditable] = useState(false)
  const [dirty, setDirty] = useState(false)

  useLoadDashboard(engine, dashboard)
  useConfigChanged(engine, () => setDirty(true))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Grafana-style operations dashboard</h2>
        <p className="text-sm text-gray-500">Operations workflow: variables/time range, editable grid, panel inspector, and config-changed dirty state.</p>
      </div>
      <Toolbar engine={engine} />
      <div className="mb-4 flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
        <button
          className={`rounded px-2 py-1 ${editable ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white'}`}
          onClick={() => setEditable((value) => !value)}
        >
          {editable ? 'Grid editing on' : 'Grid editing off'}
        </button>
        <span className={dirty ? 'text-amber-700' : 'text-gray-500'}>
          {dirty ? 'Unsaved changes' : 'No local edits'}
        </span>
        <button className="ml-auto rounded border border-gray-300 bg-white px-2 py-1" onClick={() => setDirty(false)}>
          Mark saved
        </button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <DashboardGrid engine={engine} editable={editable}>
          {(props) => (
            <div
              className={`h-full cursor-pointer ${selectedPanelId === props.instance.originId ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setSelectedPanelId(props.instance.originId)}
            >
              {renderPanel(props)}
            </div>
          )}
        </DashboardGrid>
        <GrafanaPanelEditor engine={engine} panelId={selectedPanelId} onClose={() => setSelectedPanelId(null)} />
      </div>
    </div>
  )
}

function GrafanaPanelEditor({
  engine,
  panelId,
  onClose,
}: {
  engine: CoreEngineAPI
  panelId: string | null
  onClose(): void
}) {
  const { instance, resetDraft } = usePanelDraftEditor(engine, panelId)
  const [title, setTitle] = useState('')
  const [optionTitle, setOptionTitle] = useState('')
  const [query, setQuery] = useState('')
  const [previewRows, setPreviewRows] = useState<number | null>(null)

  useEffect(() => {
    if (!instance) return
    setTitle(instance.config.title)
    setOptionTitle(String(instance.config.options.title ?? instance.config.title))
    setQuery(String(instance.config.dataRequests[0]?.query ?? ''))
    setPreviewRows(null)
  }, [instance?.id])

  if (!instance) {
    return (
      <aside className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">
        Select a panel to edit.
      </aside>
    )
  }

  const firstRequest = instance.config.dataRequests[0]

  function buildDraft() {
    return {
      title,
      options: { ...instance!.config.options, title: optionTitle },
      dataRequests: firstRequest
        ? [{ ...firstRequest, query }]
        : instance!.config.dataRequests,
    }
  }

  async function apply() {
    await engine.updatePanel(panelId!, buildDraft())
    resetDraft()
  }

  async function runPreview() {
    const result = await engine.previewPanel(panelId!, { ...instance!.config, ...buildDraft() })
    setPreviewRows(result.rawData.reduce((count, data) => count + data.rows.length, 0))
  }

  return (
    <aside className="rounded border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Panel editor</div>
          <div className="text-xs text-gray-500">{instance.originId}</div>
        </div>
        <button className="rounded border border-gray-300 px-2 py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="space-y-3 text-xs">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-600">Panel title</span>
          <input className="w-full rounded border border-gray-300 px-2 py-1" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {!instance.config.isRow && (
          <>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-600">Plugin option title</span>
              <input className="w-full rounded border border-gray-300 px-2 py-1" value={optionTitle} onChange={(event) => setOptionTitle(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-600">Datasource query</span>
              <input className="w-full rounded border border-gray-300 px-2 py-1 font-mono" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </>
        )}
        <div className="flex gap-2">
          <button className="rounded bg-gray-900 px-3 py-1.5 text-white" onClick={() => void apply()}>Apply</button>
          {!instance.config.isRow && (
            <button className="rounded border border-gray-300 px-3 py-1.5" onClick={() => void runPreview()}>Preview query</button>
          )}
        </div>
        {previewRows !== null && <div className="rounded bg-gray-50 p-2 text-gray-600">Preview rows: {previewRows}</div>}
      </div>
    </aside>
  )
}
