import { useState } from 'react'
import { ENGINE_BUILTIN_VARIABLES, buildBuiltinMap, calculateInterval } from '@loykin/dashboardkit'

const POSTGRES_BUILTINS = [
  {
    name: 'timeFilter',
    description: 'WHERE 절 시간 필터',
    signature: '$__timeFilter(col)',
    example: (col: string, from: string, to: string) =>
      `${col} BETWEEN '${from}' AND '${to}'`,
  },
  {
    name: 'timeGroup',
    description: 'GROUP BY 시간 버킷',
    signature: '$__timeGroup(col, interval)',
    example: (col: string, _from: string, _to: string, interval: string) => {
      const map: Record<string, string> = {
        '1m': 'minute', '5m': 'minute', '1h': 'hour', '1d': 'day',
      }
      return `date_trunc('${map[interval] ?? 'minute'}', ${col})`
    },
  },
  {
    name: 'timeGroupAlias',
    description: 'timeGroup + AS time 별칭',
    signature: '$__timeGroupAlias(col, interval)',
    example: (col: string, _from: string, _to: string, interval: string) => {
      const map: Record<string, string> = {
        '1m': 'minute', '5m': 'minute', '1h': 'hour', '1d': 'day',
      }
      return `date_trunc('${map[interval] ?? 'minute'}', ${col}) AS time`
    },
  },
]

const CLICKHOUSE_BUILTINS = [
  {
    name: 'timeFilter',
    description: 'ClickHouse 시간 필터 (epoch)',
    signature: '$__timeFilter(col)',
    example: (col: string, from: string, to: string) => {
      const f = Math.floor(new Date(from).getTime() / 1000)
      const t = Math.floor(new Date(to).getTime() / 1000)
      return `${col} >= toDateTime(${f}) AND ${col} <= toDateTime(${t})`
    },
  },
  {
    name: 'timeGroup',
    description: 'ClickHouse toStartOfInterval',
    signature: '$__timeGroup(col, interval)',
    example: (col: string, _from: string, _to: string, interval: string) => {
      const map: Record<string, string> = {
        '1m': '1 MINUTE', '5m': '5 MINUTE', '1h': '1 HOUR', '1d': '1 DAY',
      }
      return `toStartOfInterval(${col}, INTERVAL ${map[interval] ?? '5 MINUTE'})`
    },
  },
]

export function BuiltinsTab() {
  const [fromISO, setFromISO] = useState('2024-01-01T00:00:00Z')
  const [toISO, setToISO] = useState('2024-01-02T00:00:00Z')
  const [col, setCol] = useState('created_at')
  const [datasource, setDatasource] = useState<'postgres' | 'clickhouse'>('postgres')

  const builtinCtx = {
    timeRange: { from: fromISO, to: toISO },
    dashboard: { id: 'demo', title: 'Demo Dashboard' },
  }

  const builtinMap = buildBuiltinMap(builtinCtx)
  const interval = calculateInterval({ from: fromISO, to: toISO })
  const dsBuiltins = datasource === 'postgres' ? POSTGRES_BUILTINS : CLICKHOUSE_BUILTINS

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">from (ISO 8601)</label>
          <input
            className="font-mono text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 w-52"
            value={fromISO}
            onChange={(e) => setFromISO(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">to (ISO 8601)</label>
          <input
            className="font-mono text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 w-52"
            value={toISO}
            onChange={(e) => setToISO(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">column</label>
          <input
            className="font-mono text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 w-36"
            value={col}
            onChange={(e) => setCol(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Datasource</label>
          <div className="flex gap-1">
            {(['postgres', 'clickhouse'] as const).map((ds) => (
              <button
                key={ds}
                onClick={() => setDatasource(ds)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  datasource === ds
                    ? 'bg-blue-50 border-blue-400 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:text-gray-800'
                }`}
              >
                {ds}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Built-in Variables */}
      <div>
        <h2 className="text-xs font-semibold text-gray-700 mb-2">
          Built-in Variables{' '}
          <span className="text-gray-400 font-normal">($__ prefix, engine 자동 주입)</span>
        </h2>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase text-gray-500 tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Variable</th>
                <th className="px-4 py-2 text-left font-medium">Description</th>
                <th className="px-4 py-2 text-left font-medium font-mono">Resolved value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ENGINE_BUILTIN_VARIABLES.map((v) => (
                <tr key={v.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-purple-700 font-semibold">
                    $__
                    {v.name}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{v.description}</td>
                  <td className="px-4 py-2 font-mono text-gray-800">
                    {builtinMap[v.name] ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Built-in Functions */}
      <div>
        <h2 className="text-xs font-semibold text-gray-700 mb-2">
          Built-in Functions{' '}
          <span className="text-gray-400 font-normal">
            (datasource 등록 — 현재: {datasource})
          </span>
        </h2>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase text-gray-500 tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Signature</th>
                <th className="px-4 py-2 text-left font-medium">Description</th>
                <th className="px-4 py-2 text-left font-medium font-mono">
                  Output (col={col}, interval={interval})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dsBuiltins.map((fn) => (
                <tr key={fn.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-orange-700 font-semibold">
                    {fn.signature}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{fn.description}</td>
                  <td className="px-4 py-2 font-mono text-gray-800">
                    {fn.example(col, fromISO, toISO, interval)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          실제 엔진에서는 <code className="font-mono">defineDatasource({'{ builtins: [...] }'})</code>로 등록한 함수가 여기에 표시됩니다.
        </p>
      </div>
    </div>
  )
}
