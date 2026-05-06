import { useEffect } from 'react'
import { createDashboardEngine, definePanel } from '@loykin/dashboardkit'
import { defineDatasource } from '@/lib/datasource-adapter'
import { useAnnotations, useLoadDashboard } from '@loykin/dashboardkit/react'
import type { Annotation, DashboardInput } from '@loykin/dashboardkit'

const ds = defineDatasource({
  uid: 'events',
  type: 'events',
  async queryData() {
    return { columns: [], rows: [] }
  },
  annotations: {
    async queryAnnotations() {
      const now = Date.now()
      const events: Annotation[] = [
        {
          time: now - 3_600_000 * 3,
          title: 'Deploy v1.4.0',
          tags: ['deploy'],
          color: '#3B82F6',
        },
        {
          time: now - 3_600_000 * 2,
          title: 'Alert: CPU > 90%',
          text: 'api-2 sustained high CPU for 8 min',
          tags: ['alert'],
          color: '#EF4444',
        },
        {
          time: now - 3_600_000,
          timeEnd: now - 1_800_000,
          title: 'Maintenance window',
          tags: ['maintenance'],
          color: '#F59E0B',
        },
        {
          time: now - 900_000,
          title: 'Deploy v1.4.1 (hotfix)',
          tags: ['deploy'],
          color: '#3B82F6',
        },
      ]
      return events
    },
  },
})

const engine = createDashboardEngine({
  panels: [definePanel({ id: 'chart', name: 'Chart', optionsSchema: {}, transform: () => null })],
  datasourceAdapter: ds,
  variableTypes: [],
})

const DASHBOARD: DashboardInput = {
  schemaVersion: 1,
  id: 'annotations',
  title: 'Annotations Demo',
  panels: [{ id: 'chart-1', type: 'chart', title: '', gridPos: { x: 0, y: 0, w: 12, h: 4 } }],
  annotations: [
    { id: 'ops-events', name: 'Ops Events', datasourceUid: 'events', query: 'all' },
  ],
}

const TAG_STYLES: Record<string, string> = {
  deploy: 'bg-blue-100 text-blue-700',
  alert: 'bg-red-100 text-red-700',
  maintenance: 'bg-amber-100 text-amber-700',
}

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function AnnotationsTab() {
  useLoadDashboard(engine, DASHBOARD)
  const { annotations, loading, error, refresh } = useAnnotations(engine)

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Annotations</h1>
      <p className="text-sm text-gray-500 mb-6">
        Declare <code className="bg-gray-100 px-1 rounded">annotations[]</code> in the dashboard config.
        Datasources opt in by implementing{' '}
        <code className="bg-gray-100 px-1 rounded">annotations.queryAnnotations(annotationQuery, context)</code>.
        Fetch them with <code className="bg-gray-100 px-1 rounded">engine.getAnnotations()</code> or the{' '}
        <code className="bg-gray-100 px-1 rounded">useAnnotations()</code> hook.
      </p>

      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mb-5">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
          {!loading && !error && (
            <span className="text-xs text-gray-400">{annotations.length} annotation{annotations.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="space-y-2">
          {annotations.map((a, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded bg-white border border-gray-100">
              <div
                className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: a.color ?? '#6B7280' }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-xs font-medium">{a.title}</span>
                  {a.tags?.map((tag) => (
                    <span key={tag} className={`text-xs px-1.5 py-0.5 rounded ${TAG_STYLES[tag] ?? 'bg-gray-100 text-gray-600'}`}>
                      {tag}
                    </span>
                  ))}
                </div>
                {a.text && <p className="text-xs text-gray-500 mb-0.5">{a.text}</p>}
                <p className="text-xs text-gray-400">
                  {fmt(a.time)}{a.timeEnd ? ` → ${fmt(a.timeEnd)}  (range)` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 bg-gray-900 rounded text-xs font-mono text-gray-300 leading-relaxed">
        <div className="text-gray-500 mb-1">// Dashboard config</div>
        <div>annotations: [{'{'} id: <span className="text-green-400">'ops'</span>, datasourceUid: <span className="text-green-400">'events'</span>, query: <span className="text-green-400">'all'</span> {'}'}]</div>
        <div className="mt-2 text-gray-500">// Datasource opt-in</div>
        <div>async queryAnnotations(aq, context): <span className="text-blue-400">Promise{'<Annotation[]>'}</span></div>
        <div className="mt-2 text-gray-500">// React</div>
        <div>{'const { annotations } = useAnnotations(engine)'}</div>
      </div>
    </div>
  )
}
