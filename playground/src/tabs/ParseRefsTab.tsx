import { useState } from 'react'
import { parseRefs } from '@dashboard-engine/core'
import type { ParseResult } from '@dashboard-engine/core'

const PRESETS = [
  {
    label: 'Single variable',
    value: "SELECT * FROM orders WHERE country = '$country'",
  },
  {
    label: 'Format specifier',
    value: 'SELECT * FROM sales WHERE city IN (${city:sqlin})',
  },
  {
    label: 'Built-in variable',
    value: 'WHERE created_at > $__from AND created_at < $__to',
  },
  {
    label: 'Built-in function',
    value: 'WHERE $__timeFilter(created_at) GROUP BY $__timeGroup(created_at, $interval)',
  },
  {
    label: 'Mixed / duplicates',
    value: "SELECT $a, $a, $b FROM t WHERE $__from > 0 AND $__timeFilter(ts) AND x = '$a'",
  },
]

const KIND_COLOR: Record<string, string> = {
  variable: 'bg-blue-100 text-blue-800',
  'builtin-var': 'bg-purple-100 text-purple-800',
  'builtin-func': 'bg-orange-100 text-orange-800',
}

export function ParseRefsTab() {
  const [template, setTemplate] = useState(PRESETS[0]!.value)
  const result: ParseResult = parseRefs(template)

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Template string</h2>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setTemplate(p.value)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                template === p.value
                  ? 'bg-blue-50 border-blue-400 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-400'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <textarea
          className="w-full h-20 font-mono text-sm bg-gray-50 border border-gray-200 rounded p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Tokens */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Tokens{' '}
          <span className="font-normal text-gray-400">({result.tokens.length})</span>
        </h2>
        {result.tokens.length === 0 ? (
          <p className="text-sm text-gray-400">No tokens found.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-xs font-mono">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left">raw</th>
                  <th className="px-4 py-2 text-left">kind</th>
                  <th className="px-4 py-2 text-left">name</th>
                  <th className="px-4 py-2 text-left">format</th>
                  <th className="px-4 py-2 text-left">args</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.tokens.map((tok, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">{tok.raw}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${KIND_COLOR[tok.kind]}`}>
                        {tok.kind}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{tok.name}</td>
                    <td className="px-4 py-2 text-gray-400">{tok.format ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-400">
                      {tok.args ? `[${tok.args.join(', ')}]` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* refs */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          refs (DAG edges){' '}
          <span className="font-normal text-gray-400">({result.refs.length})</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {result.refs.length === 0 ? (
            <span className="text-sm text-gray-400">none</span>
          ) : (
            result.refs.map((r) => (
              <span key={r} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200">
                ${r}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
