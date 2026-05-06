import { useEffect, useMemo, useState } from 'react'
import { createDashboardEngine, definePanel } from '@loykin/dashboardkit'
import { defineDatasource } from '@/lib/datasource-adapter'
import { useLoadDashboard, usePanel } from '@loykin/dashboardkit/react'
import type { DashboardInput } from '@loykin/dashboardkit'

const streamDs = defineDatasource({
  uid: 'live',
  type: 'live',
  async queryData() {
    return { columns: [{ name: 'value', type: 'number' }, { name: 'ts', type: 'string' }], rows: [] }
  },
  subscribeData(_request, _context, onData) {
    const id = setInterval(() => {
      onData({
        columns: [{ name: 'value', type: 'number' }, { name: 'ts', type: 'string' }],
        rows: Array.from({ length: 6 }, (_, i) => [
          Math.round(20 + Math.random() * 80),
          new Date(Date.now() - (5 - i) * 1500).toLocaleTimeString(),
        ]),
      })
    }, 1500)
    return () => clearInterval(id)
  },
})

const livePanel = definePanel({
  id: 'live',
  name: 'Live',
  optionsSchema: {},
  transform(results) { return results[0]?.rows ?? [] },
})

const engine = createDashboardEngine({
  panels: [livePanel],
  datasourceAdapter: streamDs,
  variableTypes: [],
})

const DASHBOARD: DashboardInput = {
  schemaVersion: 1,
  id: 'streaming',
  title: 'Streaming Demo',
  panels: [{
    id: 'live-1',
    type: 'live',
    title: 'Live Metrics',
    gridPos: { x: 0, y: 0, w: 12, h: 6 },
    dataRequests: [{ id: 'main', uid: 'live', type: 'live' }],
  }],
}

export function StreamingTab() {
  useLoadDashboard(engine, DASHBOARD)
  const panel = usePanel(engine, 'live-1')
  const rows = (panel.data as unknown[][] | null) ?? []
  const [tick, setTick] = useState(0)

  useEffect(() => {
    return engine.subscribe((e) => {
      if (e.type === 'panel-data') setTick((n) => n + 1)
    })
  }, [])

  const max = useMemo(() => Math.max(...rows.map((r) => Number(r[0])), 1), [rows])

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Streaming Datasource</h1>
      <p className="text-sm text-gray-500 mb-6">
        When a datasource defines <code className="bg-gray-100 px-1 rounded">subscribeData()</code>,
        the engine calls it instead of <code className="bg-gray-100 px-1 rounded">queryData()</code>.
        Subscriptions are cleaned up automatically on panel removal, dashboard unload, or explicit refresh.
      </p>

      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${panel.streaming ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            <span className="text-xs text-gray-600">
              {panel.streaming ? 'Streaming' : 'Idle'} · {tick} updates received
            </span>
          </div>
          <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
            PanelState.streaming = {String(panel.streaming)}
          </code>
        </div>

        {rows.length > 0 ? (
          <div className="space-y-1.5">
            {rows.map((row, i) => {
              const value = Number(row[0])
              const pct = Math.round((value / max) * 100)
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-20 shrink-0">{String(row[1])}</span>
                  <div className="flex-1 bg-gray-200 rounded h-4 overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-gray-700 w-8 text-right">{value}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Waiting for first push…</p>
        )}
      </div>

      <div className="p-3 bg-gray-900 rounded text-xs font-mono text-gray-300 leading-relaxed">
        <div className="text-gray-500 mb-1">// Datasource definition</div>
        <div>defineDatasource{'({'}</div>
        <div className="pl-4">uid: <span className="text-green-400">'live-metrics'</span>,</div>
        <div className="pl-4 text-gray-400">async queryData(_request, options) {'{ ... }'},  <span className="text-gray-600">// fallback</span></div>
        <div className="pl-4">subscribeData(request, context, onData, onError) {'{'}</div>
        <div className="pl-8 text-gray-400">// push new data whenever it arrives</div>
        <div className="pl-8">onData(result)</div>
        <div className="pl-8">return {'() => cleanup()'}</div>
        <div className="pl-4">{'}'},</div>
        <div>{'})'}</div>
      </div>
    </div>
  )
}
