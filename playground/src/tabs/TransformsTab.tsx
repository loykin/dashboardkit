import { useMemo, useState } from 'react'
import { applyTransforms } from '@loykin/dashboardkit'
import type { QueryResult } from '@loykin/dashboardkit'

const S = {
  section: 'mb-8',
  heading: 'text-base font-semibold mb-1',
  sub: 'text-xs text-gray-500 mb-3',
  card: 'border border-gray-200 rounded-lg p-4 bg-gray-50',
  table: 'w-full text-xs border-collapse',
  th: 'text-left px-2 py-1 bg-gray-100 font-medium border border-gray-200',
  td: 'px-2 py-1 border border-gray-200 font-mono',
}

const RAW: QueryResult[] = [
  {
    columns: [
      { name: 'host', type: 'string' },
      { name: 'errors', type: 'number' },
      { name: 'total', type: 'number' },
    ],
    rows: [
      ['api-1', 12, 400],
      ['api-2', 5, 300],
      ['api-1', 8, 200],
      ['api-3', 0, 150],
      ['api-2', 20, 500],
    ],
  },
  {
    columns: [
      { name: 'host', type: 'string' },
      { name: 'latency_ms', type: 'number' },
    ],
    rows: [
      ['api-1', 120],
      ['api-2', 85],
      ['api-3', 200],
    ],
  },
]

type Step = 'raw' | 'merge' | 'groupBy' | 'calculate' | 'sortBy' | 'filterByValue' | 'rename'

const STEPS: Step[] = ['raw', 'merge', 'groupBy', 'calculate', 'sortBy', 'filterByValue', 'rename']

const STEP_LABELS: Record<Step, string> = {
  raw: 'raw (2 results)',
  merge: 'merge (by host)',
  groupBy: 'groupBy host · sum',
  calculate: 'calculate error_rate',
  sortBy: 'sortBy error_rate ↓',
  filterByValue: 'filterByValue total > 200',
  rename: 'rename → "error %"',
}

const STEP_CODE: Record<Step, string> = {
  raw: '// raw QueryResult[] from two datasource requests',
  merge: "{ type: 'merge', by: 'host' }",
  groupBy: "{ type: 'groupBy', by: 'host', calc: 'sum' }",
  calculate: "{ type: 'calculate', alias: 'error_rate', expr: 'errors / total' }",
  sortBy: "{ type: 'sortBy', field: 'error_rate', order: 'desc' }",
  filterByValue: "{ type: 'filterByValue', field: 'total', op: '>', threshold: 200 }",
  rename: "{ type: 'rename', from: 'error_rate', to: 'error %' }",
}

function applyUpTo(target: Step): QueryResult[] {
  const idx = STEPS.indexOf(target)
  if (idx === 0) return RAW
  type T = Parameters<typeof applyTransforms>[1][number]
  const transforms: T[] = []
  if (idx >= 1) transforms.push({ type: 'merge', by: 'host' })
  if (idx >= 2) transforms.push({ type: 'groupBy', by: 'host', calc: 'sum' })
  if (idx >= 3) transforms.push({ type: 'calculate', alias: 'error_rate', expr: 'errors / total' })
  if (idx >= 4) transforms.push({ type: 'sortBy', field: 'error_rate', order: 'desc' })
  if (idx >= 5) transforms.push({ type: 'filterByValue', field: 'total', op: '>', threshold: 200 })
  if (idx >= 6) transforms.push({ type: 'rename', from: 'error_rate', to: 'error %' })
  return applyTransforms(RAW, transforms)
}

function ResultTable({ results }: { results: QueryResult[] }) {
  if (results.length === 0) return <p className="text-xs text-gray-400">No data</p>
  return (
    <div className="space-y-3">
      {results.map((result, ri) => (
        <div key={ri}>
          {results.length > 1 && (
            <p className="text-xs text-gray-400 mb-1">Result [{ri}]</p>
          )}
          <table className={S.table}>
            <thead>
              <tr>{result.columns.map((c) => <th key={c.name} className={S.th}>{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={S.td}>
                      {typeof cell === 'number' ? +cell.toFixed(4) : String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

export function TransformsTab() {
  const [step, setStep] = useState<Step>('raw')
  const results = useMemo(() => applyUpTo(step), [step])
  const appliedSteps = STEPS.slice(1, STEPS.indexOf(step) + 1)

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">Data Transforms</h1>
      <p className="text-sm text-gray-500 mb-6">
        A declarative pipeline applied to raw <code className="bg-gray-100 px-1 rounded">QueryResult[]</code>{' '}
        before <code className="bg-gray-100 px-1 rounded">transform()</code> is called.
        Each step is a pure function — composable and testable in isolation.
      </p>

      <div className={S.section}>
        <p className="text-xs font-medium text-gray-600 mb-2">Click a step to apply it:</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {STEPS.map((s) => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                step === s
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              {STEP_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Applied pipeline */}
        {appliedSteps.length > 0 && (
          <div className="mb-3 p-3 bg-gray-900 rounded text-xs font-mono text-green-400 leading-relaxed">
            <span className="text-gray-500">applyTransforms(results, [</span>
            {appliedSteps.map((s) => (
              <div key={s} className="pl-4">{STEP_CODE[s]},</div>
            ))}
            <span className="text-gray-500">])</span>
          </div>
        )}

        <div className={S.card}>
          <ResultTable results={results} />
        </div>

        <p className="text-xs text-gray-400 mt-3">
          <code className="bg-gray-100 px-1 rounded">applyTransforms()</code> is also exported from the
          main entrypoint — usable standalone, without an engine instance.
        </p>
      </div>
    </div>
  )
}
