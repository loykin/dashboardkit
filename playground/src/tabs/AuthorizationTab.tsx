import React from 'react'
import {
  createDashboardEngine,
  defineDatasource,
  definePanel,
} from '@dashboard-engine/core'
import { DashboardGrid } from '@dashboard-engine/core/react'
import type {
  AuthContext,
  DashboardInput,
  PanelPluginDef,
  QueryOptions,
  QueryResult,
} from '@dashboard-engine/core'
import type { PanelRenderProps } from '@dashboard-engine/core/react'

type Role = 'viewer' | 'editor'

interface BackendLog {
  role: Role
  payload: {
    dashboardId: string
    panelId: string
    refId: string
    variables: Record<string, string | string[]>
    timeRange?: { from: string; to: string }
  }
}

const tablePanel = definePanel({
  id: 'secure-table',
  name: 'Secure Table',
  optionsSchema: {},
  transform(result: QueryResult) {
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])),
    )
  },
  component: () => null,
})

const config: DashboardInput = {
  schemaVersion: 1,
  id: 'secure-sales',
  title: 'Secure Sales',
  variables: [
    {
      name: 'country',
      type: 'static',
      defaultValue: 'KR',
      options: {},
    },
  ],
  timeRange: { from: 'now-1h', to: 'now' },
  panels: [
    {
      id: 'sales-by-country',
      type: 'secure-table',
      title: 'Sales By Country',
      gridPos: { x: 0, y: 0, w: 12, h: 6 },
      datasource: { uid: 'backend-query-api', type: 'backend' },
      targets: [{ refId: 'A' }],
      options: {},
    },
  ],
  layout: { cols: 12, rowHeight: 36 },
}

function authContextForRole(role: Role): AuthContext {
  return {
    subject: {
      id: `${role}-user`,
      roles: [role],
    },
  }
}

export function AuthorizationTab() {
  const [role, setRole] = React.useState<Role>('viewer')
  const [logs, setLogs] = React.useState<BackendLog[]>([])

  const roleRef = React.useRef(role)
  roleRef.current = role

  const engine = React.useMemo(() => {
    const datasource = defineDatasource({
      uid: 'backend-query-api',
      async query(options: QueryOptions) {
        setLogs((current) => [
          {
            role: roleRef.current,
            payload: {
              dashboardId: options.dashboardId,
              panelId: options.panelId,
              refId: options.refId,
              variables: options.variables,
              ...(options.timeRange ? { timeRange: options.timeRange } : {}),
            },
          },
          ...current,
        ])

        return {
          columns: [
            { name: 'country', type: 'string' },
            { name: 'amount', type: 'number' },
          ],
          rows: [[options.variables['country'] ?? 'KR', 1200]],
        }
      },
    })

    return createDashboardEngine({
      datasources: [datasource],
      panels: [tablePanel] as PanelPluginDef[],
      variableTypes: [
        {
          id: 'static',
          name: 'Static',
          optionsSchema: {},
          async resolve(variableConfig) {
            const value = Array.isArray(variableConfig.defaultValue)
              ? variableConfig.defaultValue[0]
              : variableConfig.defaultValue
            return value ? [{ label: value, value }] : []
          },
        },
      ],
      authContext: authContextForRole(roleRef.current),
      authorize() {
        return true
      },
    })
  }, [])

  React.useEffect(() => {
    engine.setAuthContext(authContextForRole(role))
  }, [engine, role])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRole('viewer')}
            className={`rounded border px-3 py-1.5 text-xs font-medium ${
              role === 'viewer'
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            Viewer
          </button>
          <button
            onClick={() => setRole('editor')}
            className={`rounded border px-3 py-1.5 text-xs font-medium ${
              role === 'editor'
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            Editor
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void engine.refreshAll()}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
          >
            Refresh
          </button>
          <button
            onClick={() => setLogs([])}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
          >
            Clear Logs
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <DashboardGrid engine={engine} config={config} className="min-w-0">
          {(props) => <PanelShell {...props} />}
        </DashboardGrid>

        <div className="rounded border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">
            Backend Request Log
          </div>
          <div className="max-h-[320px] overflow-auto p-3">
            {logs.length === 0 ? (
              <p className="text-xs text-gray-400">No backend requests</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log, index) => (
                  <pre
                    key={index}
                    className="overflow-auto rounded bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100"
                  >
                    {JSON.stringify(log, null, 2)}
                  </pre>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded border border-gray-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-gray-700">Frontend Target</div>
        <pre className="overflow-auto rounded bg-gray-50 p-3 text-[11px] text-gray-700">
          {JSON.stringify(config.panels[0]?.targets[0], null, 2)}
        </pre>
      </div>
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
        <span className="text-xs font-semibold text-gray-700">Sales By Country</span>
        {loading && <span className="text-[10px] text-blue-500">loading</span>}
        {error && <span className="text-[10px] text-red-500">blocked</span>}
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
