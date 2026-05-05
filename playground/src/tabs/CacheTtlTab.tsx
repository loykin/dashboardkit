import { useEffect, useRef, useState } from 'react'
import { createDashboardEngine, defineDatasource, definePanel } from '@loykin/dashboardkit'
import { useLoadDashboard, usePanel } from '@loykin/dashboardkit/react'
import type { DashboardInput } from '@loykin/dashboardkit'

// Tracks real datasource invocations across renders
let invokeCount = 0
let lastResult: [string, number][] = []

const ds = defineDatasource({
  uid: 'slow-api',
  type: 'slow',
  cacheTtlMs: 3000,
  async queryData() {
    invokeCount++
    lastResult = [
      ['cpu', Math.round(Math.random() * 100)],
      ['mem', Math.round(Math.random() * 100)],
      ['disk', Math.round(Math.random() * 100)],
    ]
    return {
      columns: [{ name: 'metric', type: 'string' }, { name: 'value', type: 'number' }],
      rows: lastResult,
    }
  },
})

const panel = definePanel({
  id: 'metrics',
  name: 'Metrics',
  optionsSchema: {},
  transform(results) { return results[0]?.rows ?? [] },
})

const engine = createDashboardEngine({
  panels: [panel],
  datasourcePlugins: [ds],
  variableTypes: [],
})

const DASHBOARD: DashboardInput = {
  schemaVersion: 1,
  id: 'cache-ttl',
  title: 'Cache TTL Demo',
  panels: [{
    id: 'metrics-1',
    type: 'metrics',
    title: 'System Metrics',
    gridPos: { x: 0, y: 0, w: 12, h: 4 },
    dataRequests: [{ id: 'main', uid: 'slow-api', type: 'slow' }],
  }],
}

const SWR_DASHBOARD: DashboardInput = {
  ...DASHBOARD,
  id: 'cache-ttl-swr',
  panels: [{
    ...DASHBOARD.panels[0]!,
    id: 'metrics-swr',
    dataRequests: [{ id: 'main', uid: 'slow-api', type: 'slow', cacheTtlMs: 3000, staleWhileRevalidate: true }],
  }],
}

export function CacheTtlTab() {
  const [mode, setMode] = useState<'ttl' | 'swr'>('ttl')
  const [refreshCount, setRefreshCount] = useState(0)
  const [realCount, setRealCount] = useState(0)
  const panelId = mode === 'ttl' ? 'metrics-1' : 'metrics-swr'
  const dashboard = mode === 'ttl' ? DASHBOARD : SWR_DASHBOARD

  useLoadDashboard(engine, dashboard)
  const panelState = usePanel(engine, panelId)
  const rows = (panelState.data as unknown[][] | null) ?? []
  const countRef = useRef(invokeCount)

  function handleRefresh() {
    void engine.refreshPanel(panelId)
    setRefreshCount((n) => n + 1)
    setTimeout(() => setRealCount(invokeCount), 80)
  }

  useEffect(() => {
    setRefreshCount(0)
    invokeCount = 0
    countRef.current = 0
    setRealCount(0)
    void engine.refreshPanel(panelId)
  }, [mode, panelId])

  useEffect(() => {
    setTimeout(() => setRealCount(invokeCount), 200)
  }, [panelState.data])

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Cache TTL</h1>
      <p className="text-sm text-gray-500 mb-6">
        Set <code className="bg-gray-100 px-1 rounded">cacheTtlMs</code> on a datasource or individual data
        request. Results are served from cache until the TTL expires, reducing unnecessary datasource calls.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        {(['ttl', 'swr'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-xs rounded border transition-colors ${
              mode === m ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-500'
            }`}
          >
            {m === 'ttl' ? 'TTL only (cacheTtlMs: 3000)' : 'staleWhileRevalidate: true'}
          </button>
        ))}
      </div>

      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mb-4">
        <div className="flex items-center gap-6 mb-4">
          <button onClick={handleRefresh} className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">
            Refresh panel
          </button>
          <div className="text-xs text-gray-600 space-y-0.5">
            <div>Button clicks: <strong>{refreshCount}</strong></div>
            <div>Datasource calls: <strong className="text-blue-600">{realCount}</strong></div>
          </div>
          <div className="text-xs text-gray-400 flex-1">
            {mode === 'ttl'
              ? 'Cache hit within 3 s → datasource is NOT called.'
              : 'Stale data returned immediately; background fetch updates silently.'}
          </div>
        </div>

        {rows.length > 0 ? (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1 bg-gray-100 font-medium border border-gray-200">metric</th>
                <th className="text-left px-2 py-1 bg-gray-100 font-medium border border-gray-200">value</th>
                <th className="text-left px-2 py-1 bg-gray-100 font-medium border border-gray-200">bar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1 border border-gray-200 font-mono">{String(row[0])}</td>
                  <td className="px-2 py-1 border border-gray-200 font-mono">{String(row[1])}</td>
                  <td className="px-2 py-1 border border-gray-200">
                    <div className="bg-gray-200 rounded h-3 overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded transition-all duration-300"
                        style={{ width: `${Number(row[1])}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-gray-400">Loading…</p>
        )}
      </div>

      <div className="p-3 bg-gray-900 rounded text-xs font-mono text-gray-300 leading-relaxed">
        {mode === 'ttl' ? (
          <>
            <div className="text-gray-500 mb-1">// Datasource-level TTL</div>
            <div>defineDatasource{'({'} uid: <span className="text-green-400">'slow-api'</span>, cacheTtlMs: <span className="text-yellow-400">3000</span>, ... {'})'}</div>
            <div className="mt-2 text-gray-500">// Or per data request</div>
            <div>dataRequests: [{'{'} uid: <span className="text-green-400">'slow-api'</span>, cacheTtlMs: <span className="text-yellow-400">3000</span> {'}'}]</div>
          </>
        ) : (
          <>
            <div className="text-gray-500 mb-1">// stale-while-revalidate: serve stale, fetch in background</div>
            <div>dataRequests: [{'{'}</div>
            <div className="pl-4">uid: <span className="text-green-400">'slow-api'</span>,</div>
            <div className="pl-4">cacheTtlMs: <span className="text-yellow-400">3000</span>,</div>
            <div className="pl-4">staleWhileRevalidate: <span className="text-yellow-400">true</span>,</div>
            <div>{'}'}]</div>
          </>
        )}
      </div>
    </div>
  )
}
