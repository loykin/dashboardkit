import { useEffect, useState } from 'react'
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
  exportToCsv,
} from '@loykin/dashboardkit'
import { useLoadDashboard, usePanel } from '@loykin/dashboardkit/react'
import type { DashboardInput } from '@loykin/dashboardkit'

const S = {
  card: 'border border-gray-200 rounded-lg p-4 bg-gray-50',
  table: 'w-full text-xs border-collapse',
  th: 'text-left px-2 py-1 bg-gray-100 font-medium border border-gray-200',
  td: 'px-2 py-1 border border-gray-200 font-mono',
  btn: 'px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700',
  btnGray: 'px-3 py-1.5 text-xs rounded bg-gray-200 text-gray-700 hover:bg-gray-300',
}

// Two panels, same datasource, different panel types.
// The point: rawData exists on every panel regardless of how transform() shapes it.

const ds = defineDatasource({
  uid: 'hosts',
  type: 'mock',
  async query({ variables }) {
    const region = String(variables['region'] ?? 'KR')
    const DATA: Record<string, [string, number, number][]> = {
      KR: [['api-1', 12, 420], ['api-2', 5, 310], ['api-3', 0, 180]],
      US: [['web-1', 3, 900], ['web-2', 8, 600], ['web-3', 1, 400]],
    }
    return {
      columns: [
        { name: 'host', type: 'string' },
        { name: 'errors', type: 'number' },
        { name: 'requests', type: 'number' },
      ],
      rows: DATA[region] ?? [],
    }
  },
})

// Stat: collapses rawData to a single error-rate string
const statPanel = definePanel({
  id: 'stat',
  name: 'Stat',
  optionsSchema: {},
  transform(results) {
    const rows = results[0]?.rows ?? []
    const errors = rows.reduce((s, r) => s + Number(r[1]), 0)
    const total = rows.reduce((s, r) => s + Number(r[2]), 0)
    return total > 0 ? ((errors / total) * 100).toFixed(2) + '%' : '—'
  },
})

// Table: passes rawData rows through as-is
const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  transform(results) { return results[0]?.rows ?? [] },
})

const engine = createDashboardEngine({
  panels: [statPanel, tablePanel],
  datasourcePlugins: [ds],
  variableTypes: [],
})

const DASHBOARD: DashboardInput = {
  schemaVersion: 1,
  id: 'csv-export',
  title: 'CSV Export Demo',
  panels: [
    {
      id: 'stat-1',
      type: 'stat',
      title: 'Error Rate',
      gridPos: { x: 0, y: 0, w: 6, h: 3 },
      dataRequests: [{ id: 'main', uid: 'hosts', type: 'mock' }],
    },
    {
      id: 'table-1',
      type: 'table',
      title: 'Host Table',
      gridPos: { x: 6, y: 0, w: 18, h: 6 },
      dataRequests: [{ id: 'main', uid: 'hosts', type: 'mock' }],
    },
  ],
  variables: [
    { name: 'region', type: 'custom', options: { values: 'KR,US' }, defaultValue: 'KR' },
  ],
}

function download(panelId: string, filename: string) {
  const raw = engine.getPanel(panelId)?.rawData ?? []
  const csv = exportToCsv(raw)
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function CsvExportTab() {
  const [region, setRegion] = useState('KR')
  const [downloaded, setDownloaded] = useState<string | null>(null)

  useLoadDashboard(engine, DASHBOARD)

  const stat = usePanel(engine, 'stat-1')
  const table = usePanel(engine, 'table-1')
  const tableRows = (table.data as unknown[][] | null) ?? []

  useEffect(() => {
    engine.setVariable('region', region)
  }, [region])

  function handleDownload(panelId: string, filename: string) {
    download(panelId, filename)
    setDownloaded(panelId)
    setTimeout(() => setDownloaded(null), 1800)
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">CSV Export</h1>
      <p className="text-sm text-gray-500 mb-2">
        <code className="bg-gray-100 px-1 rounded">exportToCsv(rawData)</code> works on any panel type.
        Every panel has <code className="bg-gray-100 px-1 rounded">rawData: QueryResult[]</code> — the
        unprocessed datasource response — regardless of how <code className="bg-gray-100 px-1 rounded">transform()</code> shapes it for rendering.
      </p>
      <p className="text-sm text-gray-500 mb-6">
        The stat panel renders a single percentage. The table renders rows directly.
        Both export the same underlying raw data.
      </p>

      {/* Region selector */}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-xs font-medium text-gray-600">Region</span>
        {['KR', 'US'].map((r) => (
          <button
            key={r}
            onClick={() => setRegion(r)}
            className={`px-3 py-1 text-xs rounded border ${
              region === r ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Stat panel */}
        <div className={S.card}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-600">Stat — Error Rate</span>
            <button
              onClick={() => handleDownload('stat-1', 'stat-rawdata.csv')}
              className={S.btnGray}
            >
              {downloaded === 'stat-1' ? '✓ downloaded' : '⬇ Export CSV'}
            </button>
          </div>
          <p className="text-3xl font-mono font-semibold text-gray-800 mb-3">
            {stat.loading ? '…' : String(stat.data ?? '—')}
          </p>
          <p className="text-xs text-gray-400">
            <code className="bg-gray-100 px-1 rounded">transform()</code> reduced rawData to one value —
            but the CSV export uses <code className="bg-gray-100 px-1 rounded">rawData</code>, so you still
            get all rows.
          </p>
        </div>

        {/* Table panel */}
        <div className={S.card}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-600">Table — Host Metrics</span>
            <button
              onClick={() => handleDownload('table-1', 'table-rawdata.csv')}
              className={S.btnGray}
            >
              {downloaded === 'table-1' ? '✓ downloaded' : '⬇ Export CSV'}
            </button>
          </div>
          {tableRows.length > 0 ? (
            <table className={S.table}>
              <thead>
                <tr>
                  {['host', 'errors', 'requests'].map((c) => (
                    <th key={c} className={S.th}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={S.td}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-400">Loading…</p>
          )}
        </div>
      </div>

      <div className="mt-5 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600 font-mono">
        <div className="text-gray-400 mb-1">// Usage</div>
        <div>{'import { exportToCsv } from \'@loykin/dashboardkit\''}</div>
        <div className="mt-1">{'const csv = exportToCsv(engine.getPanel(\'table-1\')?.rawData ?? [])'}</div>
      </div>
    </div>
  )
}
