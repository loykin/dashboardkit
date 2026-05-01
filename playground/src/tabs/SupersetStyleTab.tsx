import { useEffect, useMemo, useState } from 'react'
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
} from '@loykin/dashboardkit'
import { DashboardGrid, useConfigChanged, useEngineEvent, useLoadDashboard, usePanelDraftEditor } from '@loykin/dashboardkit/react'
import type { CoreEngineAPI, DashboardInput, QueryOptions, QueryResult } from '@loykin/dashboardkit'
import type { PanelRenderProps } from '@loykin/dashboardkit/react'

const salesRows = [
  ['KR', 'platform', 128],
  ['KR', 'search', 91],
  ['US', 'platform', 146],
  ['US', 'search', 74],
  ['JP', 'platform', 83],
  ['JP', 'search', 57],
]

const chartPanel = definePanel({
  id: 'bar',
  name: 'Bar',
  optionsSchema: {
    dimension: { type: 'string', label: 'Dimension', required: true },
    title: { type: 'string', label: 'Title', required: true },
  },
  transform(results: QueryResult[]) {
    return results[0]?.rows ?? []
  },
})

const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  transform(results: QueryResult[]) {
    return results[0]?.rows ?? []
  },
})

function filteredRows(options: QueryOptions) {
  return salesRows.filter(([country, segment]) => {
    if (options.variables.country && options.variables.country !== country) return false
    return !(options.variables.segment && options.variables.segment !== segment);

  })
}

const datasource = defineDatasource({
  uid: 'sales',
  type: 'sales',
  async query(options) {
    const rows = filteredRows(options)
    const dimension = String((options.dataRequest.options.dimension ?? 'country'))
    if (dimension === 'segment') {
      const grouped = new Map<string, number>()
      rows.forEach(([, segment, value]) => grouped.set(String(segment), (grouped.get(String(segment)) ?? 0) + Number(value)))
      return {
        columns: [{ name: 'segment', type: 'string' }, { name: 'value', type: 'number' }],
        rows: [...grouped.entries()],
      }
    }
    if (dimension === 'country') {
      const grouped = new Map<string, number>()
      rows.forEach(([country, , value]) => grouped.set(String(country), (grouped.get(String(country)) ?? 0) + Number(value)))
      return {
        columns: [{ name: 'country', type: 'string' }, { name: 'value', type: 'number' }],
        rows: [...grouped.entries()],
      }
    }
    return {
      columns: [
        { name: 'country', type: 'string' },
        { name: 'segment', type: 'string' },
        { name: 'value', type: 'number' },
      ],
      rows,
    }
  },
})

const dashboard: DashboardInput = {
  schemaVersion: 1,
  id: 'superset-style',
  title: 'Sales Exploration',
  layout: { cols: 24, rowHeight: 34 },
  variables: [],
  panels: [
    {
      id: 'country-chart',
      type: 'bar',
      title: 'Country',
      gridPos: { x: 0, y: 0, w: 8, h: 7 },
      options: { title: 'Country', dimension: 'country' },
      dataRequests: [{ id: 'main', uid: 'sales', type: 'sales', options: { dimension: 'country' } }],
    },
    {
      id: 'segment-chart',
      type: 'bar',
      title: 'Segment',
      gridPos: { x: 8, y: 0, w: 8, h: 7 },
      options: { title: 'Segment', dimension: 'segment' },
      dataRequests: [{ id: 'main', uid: 'sales', type: 'sales', options: { dimension: 'segment' } }],
    },
    {
      id: 'detail-table',
      type: 'table',
      title: 'Filtered records',
      gridPos: { x: 0, y: 7, w: 16, h: 7 },
      dataRequests: [{ id: 'main', uid: 'sales', type: 'sales', options: { dimension: 'records' } }],
    },
  ],
}

function SelectionState({ engine }: { engine: CoreEngineAPI }) {
  const [state, setState] = useState(engine.getPanelSelections())
  useEngineEvent(engine, (event) => {
    if (event.type === 'panel-selection-changed') setState(engine.getPanelSelections())
  })
  const entries = Object.entries(state)

  return (
    <div className="mb-4 flex items-center gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
      <span className="font-medium text-gray-600">Cross-filter</span>
      {entries.length === 0 ? <span className="text-gray-400">none</span> : entries.map(([panelId, filters]) => (
        <span key={panelId} className="rounded bg-white px-2 py-1 text-gray-700">
          {panelId}: {JSON.stringify(filters)}
        </span>
      ))}
      <button className="ml-auto rounded border border-gray-300 bg-white px-2 py-1" onClick={() => engine.clearAllPanelSelections()}>
        Clear all
      </button>
    </div>
  )
}

function BarPanel({ engine, props }: { engine: CoreEngineAPI; props: PanelRenderProps }) {
  const rows = Array.isArray(props.data) ? props.data as unknown[][] : []
  const dimension = String(props.config.options.dimension)
  const max = Math.max(1, ...rows.map((row) => Number(row[1] ?? 0)))

  return (
    <div className="h-full rounded border border-gray-200 bg-white p-3">
      <div className="mb-3 text-sm font-semibold">{props.config.title}</div>
      <div className="space-y-2">
        {rows.map((row) => {
          const label = String(row[0])
          const value = Number(row[1] ?? 0)
          return (
            <button
              key={label}
              className="grid w-full grid-cols-[72px_1fr_40px] items-center gap-2 text-left text-xs"
              onClick={() => engine.setPanelSelection(props.panelId, { [dimension]: label })}
            >
              <span className="font-medium text-gray-600">{label}</span>
              <span className="h-5 rounded bg-blue-100">
                <span className="block h-5 rounded bg-blue-500" style={{ width: `${(value / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{value}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function renderPanel(engine: CoreEngineAPI, props: PanelRenderProps) {
  if (props.loading) return <div className="p-3 text-xs text-gray-500">Loading</div>
  if (props.error) return <div className="p-3 text-xs text-red-600">{props.error}</div>
  if (props.panelType === 'bar') return <BarPanel engine={engine} props={props} />

  const rows = Array.isArray(props.data) ? props.data as unknown[][] : []
  return (
    <div className="h-full overflow-hidden rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-3 py-2 text-sm font-semibold">{props.config.title}</div>
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-gray-100">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2">{String(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SupersetStyleTab() {
  const engine = useMemo(() => createDashboardEngine({
    panels: [chartPanel, tablePanel],
    datasourcePlugins: [datasource],
    variableTypes: [],
  }), [])
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>('country-chart')
  const [dirty, setDirty] = useState(false)

  useLoadDashboard(engine, dashboard)
  useConfigChanged(engine, () => setDirty(true))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Explore cross-filter</h2>
        <p className="text-sm text-gray-500">Exploration workflow: chart cross-filters, panel editor, query preview, and viewer/editor state sync.</p>
      </div>
      <div className="mb-4 flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
        <span className={dirty ? 'text-amber-700' : 'text-gray-500'}>
          {dirty ? 'Unsaved chart edits' : 'No local edits'}
        </span>
        <button className="ml-auto rounded border border-gray-300 bg-white px-2 py-1" onClick={() => setDirty(false)}>
          Mark saved
        </button>
      </div>
      <SelectionState engine={engine} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <DashboardGrid engine={engine}>
          {(props) => (
            <div
              className={`h-full cursor-pointer ${selectedPanelId === props.instance.originId ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setSelectedPanelId(props.instance.originId)}
            >
              {renderPanel(engine, props)}
            </div>
          )}
        </DashboardGrid>
        <SupersetPanelEditor engine={engine} panelId={selectedPanelId} onClose={() => setSelectedPanelId(null)} />
      </div>
    </div>
  )
}

function SupersetPanelEditor({
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
  const [dimension, setDimension] = useState('country')
  const [previewRows, setPreviewRows] = useState<number | null>(null)

  useEffect(() => {
    if (!instance) return
    setTitle(instance.config.title)
    setDimension(String(instance.config.options.dimension ?? instance.config.dataRequests[0]?.options.dimension ?? 'records'))
    setPreviewRows(null)
  }, [instance?.id])

  if (!instance) {
    return (
      <aside className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">
        Select a chart or table to edit.
      </aside>
    )
  }

  const firstRequest = instance.config.dataRequests[0]
  const isChart = instance.type === 'bar'

  function buildDraft() {
    return {
      title,
      options: { ...instance!.config.options, title, dimension },
      dataRequests: firstRequest
        ? [{ ...firstRequest, options: { ...firstRequest.options, dimension: isChart ? dimension : 'records' } }]
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
          <div className="text-sm font-semibold">Explore editor</div>
          <div className="text-xs text-gray-500">{instance.originId}</div>
        </div>
        <button className="rounded border border-gray-300 px-2 py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="space-y-3 text-xs">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-600">Title</span>
          <input className="w-full rounded border border-gray-300 px-2 py-1" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {isChart && (
          <label className="block">
            <span className="mb-1 block font-medium text-gray-600">Group by dimension</span>
            <select className="w-full rounded border border-gray-300 px-2 py-1" value={dimension} onChange={(event) => setDimension(event.target.value)}>
              <option value="country">country</option>
              <option value="segment">segment</option>
            </select>
          </label>
        )}
        <div className="rounded bg-gray-50 p-2 text-gray-600">
          Apply uses engine.updatePanel(); Preview uses engine.previewPanel() without mutating viewer state.
        </div>
        <div className="flex gap-2">
          <button className="rounded bg-gray-900 px-3 py-1.5 text-white" onClick={() => void apply()}>Apply</button>
          <button className="rounded border border-gray-300 px-3 py-1.5" onClick={() => void runPreview()}>Preview</button>
        </div>
        {previewRows !== null && <div className="rounded bg-gray-50 p-2 text-gray-600">Preview rows: {previewRows}</div>}
      </div>
    </aside>
  )
}
