import { useState } from 'react'
import { buildVariableDAG, CircularDependencyError } from '@dashboard-engine/core'

type VarRow = { name: string; query: string }

const PRESET_NORMAL: VarRow[] = [
  { name: 'country', query: '' },
  { name: 'city', query: "SELECT city FROM regions WHERE country = '$country'" },
  { name: 'status', query: '' },
  { name: 'interval', query: '' },
  {
    name: 'sales_panel',
    query:
      "SELECT * FROM sales WHERE country = '$country' AND city IN (${city:sqlin}) AND status = '$status'",
  },
]

const PRESET_CIRCULAR: VarRow[] = [
  { name: 'a', query: "SELECT * FROM t WHERE x = '$b'" },
  { name: 'b', query: "SELECT * FROM t WHERE x = '$c'" },
  { name: 'c', query: "SELECT * FROM t WHERE x = '$a'" },
]

export function DagTab() {
  const [rows, setRows] = useState<VarRow[]>(PRESET_NORMAL)
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const updateRow = (i: number, field: keyof VarRow, val: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)))
  }

  const addRow = () => {
    setRows((prev) => [...prev, { name: `var${prev.length + 1}`, query: '' }])
    setEditIdx(rows.length)
  }

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  let sortedOrder: string[] = []
  let errorMsg = ''
  let errorCycle: string[] = []

  try {
    sortedOrder = buildVariableDAG(rows.map((r) => ({ name: r.name, query: r.query || undefined })))
  } catch (e) {
    if (e instanceof CircularDependencyError) {
      errorMsg = e.message
      errorCycle = e.cycle
    } else {
      errorMsg = String(e)
    }
  }

  // Build adjacency for display
  const adjMap = new Map<string, string[]>()
  for (const row of rows) {
    const deps: string[] = []
    if (row.query) {
      // extract $varName refs manually from the row (re-use the core parser)
      const knownNames = new Set(rows.map((r) => r.name))
      const matches = row.query.matchAll(/\$\{?([a-zA-Z_][a-zA-Z0-9_]*)(?::[a-zA-Z]+)?\}?/g)
      for (const m of matches) {
        const ref = m[1]!
        if (ref !== row.name && knownNames.has(ref) && !deps.includes(ref)) deps.push(ref)
      }
    }
    adjMap.set(row.name, deps)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Presets */}
      <div className="flex gap-2">
        <button
          onClick={() => setRows(PRESET_NORMAL)}
          className="px-3 py-1 text-xs rounded border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400 transition-colors"
        >
          Normal example
        </button>
        <button
          onClick={() => setRows(PRESET_CIRCULAR)}
          className="px-3 py-1 text-xs rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
        >
          Circular example
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Variable editor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-700">Variables</h2>
            <button
              onClick={addRow}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              + Add
            </button>
          </div>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div
                key={i}
                className={`rounded border p-3 space-y-1.5 cursor-pointer transition-colors ${
                  editIdx === i ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setEditIdx(i)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-gray-800">${row.name}</span>
                  {adjMap.get(row.name)?.length ? (
                    <span className="text-[10px] text-gray-400">
                      depends on: {adjMap.get(row.name)!.map((d) => `$${d}`).join(', ')}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300">no deps</span>
                  )}
                  <button
                    className="ml-auto text-gray-300 hover:text-red-400 text-xs"
                    onClick={(e) => { e.stopPropagation(); removeRow(i) }}
                  >
                    ✕
                  </button>
                </div>
                {editIdx === i && (
                  <div className="space-y-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full font-mono text-xs bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
                      placeholder="variable name"
                      value={row.name}
                      onChange={(e) => updateRow(i, 'name', e.target.value)}
                    />
                    <textarea
                      className="w-full font-mono text-xs bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none h-16"
                      placeholder="query (optional, may reference $otherVar)"
                      value={row.query}
                      onChange={(e) => updateRow(i, 'query', e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Result */}
        <div className="space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-gray-700 mb-2">Topological execution order</h2>
            {errorMsg ? (
              <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-red-600">CircularDependencyError</p>
                <p className="font-mono text-xs text-red-700">{errorMsg}</p>
                {errorCycle.length > 0 && (
                  <div className="flex flex-wrap gap-1 items-center">
                    {errorCycle.map((n, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-mono">
                          ${n}
                        </span>
                        {i < errorCycle.length - 1 && (
                          <span className="text-red-400 text-xs">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap gap-2 items-center">
                  {sortedOrder.map((name, i) => (
                    <span key={name} className="flex items-center gap-2">
                      <span className="font-mono text-xs px-2 py-1 bg-white border border-gray-200 rounded shadow-sm text-gray-800">
                        ${name}
                      </span>
                      {i < sortedOrder.length - 1 && (
                        <span className="text-gray-300 text-xs">→</span>
                      )}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-3">
                  의존 대상이 먼저 resolve됩니다. 이 순서로 variable refresh가 실행됩니다.
                </p>
              </div>
            )}
          </div>

          {/* Adjacency list */}
          <div>
            <h2 className="text-xs font-semibold text-gray-700 mb-2">Dependency edges</h2>
            <div className="rounded border border-gray-200 overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead className="bg-gray-50 text-[10px] uppercase text-gray-500 tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">variable</th>
                    <th className="px-3 py-2 text-left">depends on</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const deps = adjMap.get(r.name) ?? []
                    const inCycle = errorCycle.includes(r.name)
                    return (
                      <tr key={r.name} className={inCycle ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className={`px-3 py-2 font-semibold ${inCycle ? 'text-red-600' : 'text-gray-800'}`}>
                          ${r.name}
                        </td>
                        <td className="px-3 py-2 text-gray-400">
                          {deps.length ? deps.map((d) => `$${d}`).join(', ') : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
