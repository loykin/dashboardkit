import { useState } from 'react'
import { interpolate } from '@loykin/dashboardkit'
import type { InterpolateContext, VariableFormatter } from '@loykin/dashboardkit'

const INITIAL_TEMPLATE =
  "SELECT * FROM sales\nWHERE country = '$country'\n  AND city IN (${city:sqlin})\n  AND $__timeFilter(created_at)"

const INITIAL_VARIABLES = `{
  "country": "KR",
  "city": ["seoul", "busan"]
}`

const INITIAL_BUILTINS = `{
  "fromISO": "2024-01-01T00:00:00Z",
  "toISO":   "2024-01-02T00:00:00Z",
  "from":    "1704067200000",
  "to":      "1704153600000"
}`

function tryParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function InterpolateTab() {
  const [template, setTemplate] = useState(INITIAL_TEMPLATE)
  const [variablesJson, setVariablesJson] = useState(INITIAL_VARIABLES)
  const [builtinsJson, setBuiltinsJson] = useState(INITIAL_BUILTINS)
  const [timeFilterSql, setTimeFilterSql] = useState(
    'created_at BETWEEN :from AND :to',
  )

  const variables = tryParseJson(variablesJson) as Record<string, string | string[]>
  const builtins = tryParseJson(builtinsJson) as Record<string, string>

  const [customFormatName, setCustomFormatName] = useState('pg_literal')
  const [customFormatBody, setCustomFormatBody] = useState(
    "(val) => Array.isArray(val) ? val.map(v => `'${v}'`).join(', ') : `'${val}'`",
  )
  const [customFormatErr, setCustomFormatErr] = useState<string | null>(null)

  let customFormatters: Record<string, VariableFormatter> = {}
  try {
    if (customFormatName.trim() && customFormatBody.trim()) {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${customFormatBody})`)() as VariableFormatter
      customFormatters = { [customFormatName.trim()]: fn }
      if (customFormatErr) setCustomFormatErr(null)
    }
  } catch (e) {
    customFormatters = {}
    if (!customFormatErr) setCustomFormatErr(String(e))
  }

  const ctx: InterpolateContext = {
    variables,
    builtins,
    formatters: customFormatters,
    functions: {
      timeFilter: {
        name: 'timeFilter',
        description: 'WHERE 절 시간 필터',
        call: ([col], bCtx) =>
          `${col} BETWEEN '${bCtx.timeRange.from}' AND '${bCtx.timeRange.to}'`,
      },
      timeGroup: {
        name: 'timeGroup',
        description: 'GROUP BY 버킷',
        call: ([col, interval]) => `date_trunc('${interval}', ${col})`,
      },
    },
  }

  let result = ''
  let error = ''
  try {
    result = interpolate(template, ctx)
  } catch (e) {
    error = String(e)
  }

  const variablesValid = (() => {
    try { JSON.parse(variablesJson); return true } catch { return false }
  })()
  const builtinsValid = (() => {
    try { JSON.parse(builtinsJson); return true } catch { return false }
  })()

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: inputs */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Template</label>
            <textarea
              className="w-full h-36 font-mono text-xs bg-gray-50 border border-gray-200 rounded p-3 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold mb-1 ${variablesValid ? 'text-gray-600' : 'text-red-500'}`}>
              variables (JSON){!variablesValid && ' — invalid JSON'}
            </label>
            <textarea
              className={`w-full h-24 font-mono text-xs bg-gray-50 border rounded p-3 focus:outline-none focus:ring-2 resize-none ${variablesValid ? 'border-gray-200 focus:ring-blue-300' : 'border-red-300 focus:ring-red-300'}`}
              value={variablesJson}
              onChange={(e) => setVariablesJson(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold mb-1 ${builtinsValid ? 'text-gray-600' : 'text-red-500'}`}>
              builtins (JSON){!builtinsValid && ' — invalid JSON'}
            </label>
            <textarea
              className={`w-full h-28 font-mono text-xs bg-gray-50 border rounded p-3 focus:outline-none focus:ring-2 resize-none ${builtinsValid ? 'border-gray-200 focus:ring-blue-300' : 'border-red-300 focus:ring-red-300'}`}
              value={builtinsJson}
              onChange={(e) => setBuiltinsJson(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              $__timeFilter(col) SQL template
            </label>
            <input
              className="w-full font-mono text-xs bg-gray-50 border border-gray-200 rounded p-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
              value={timeFilterSql}
              onChange={(e) => setTimeFilterSql(e.target.value)}
            />
            <p className="text-[10px] text-gray-400 mt-1">:from / :to 는 builtins.fromISO / toISO 로 치환됨</p>
          </div>

          <div className="rounded border border-dashed border-gray-300 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-600">Custom formatter</p>
            <div className="flex gap-2">
              <div className="flex-none w-28">
                <label className="block text-[10px] text-gray-500 mb-1">Format name</label>
                <input
                  className="w-full font-mono text-xs bg-gray-50 border border-gray-200 rounded p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  value={customFormatName}
                  onChange={(e) => setCustomFormatName(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-gray-500 mb-1">Function <code>(val, varName) =&gt; string</code></label>
                <input
                  className={`w-full font-mono text-xs bg-gray-50 border rounded p-1.5 focus:outline-none focus:ring-2 ${customFormatErr ? 'border-red-300 focus:ring-red-300' : 'border-gray-200 focus:ring-blue-300'}`}
                  value={customFormatBody}
                  onChange={(e) => { setCustomFormatBody(e.target.value); setCustomFormatErr(null) }}
                />
              </div>
            </div>
            {customFormatErr && <p className="text-[10px] text-red-500">{customFormatErr}</p>}
            <p className="text-[10px] text-gray-400">
              Template에서 <code className="bg-gray-100 px-1 rounded">{'${var:' + customFormatName + '}'}</code> 로 사용
            </p>
          </div>
        </div>

        {/* Right: result */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Result</label>
          {error ? (
            <div className="rounded border border-red-200 bg-red-50 p-4 font-mono text-xs text-red-700 whitespace-pre-wrap">
              {error}
            </div>
          ) : (
            <pre className="rounded border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-800 whitespace-pre-wrap overflow-auto min-h-36">
              {result}
            </pre>
          )}

          <div className="mt-4 rounded border border-gray-100 bg-gray-50 p-3 space-y-1">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Resolved variables</p>
            {Object.entries(variables).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-xs font-mono">
                <span className="text-blue-600">${k}</span>
                <span className="text-gray-400">=</span>
                <span className="text-gray-700">{JSON.stringify(v)}</span>
              </div>
            ))}
            {Object.keys(variables).length === 0 && (
              <p className="text-xs text-gray-400">—</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
