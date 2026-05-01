import { useState } from 'react'
import { interpolate } from '@loykin/dashboardkit'

const FORMATS = [
  'csv',
  'sqlstring',
  'sqlin',
  'json',
  'regex',
  'pipe',
  'glob',
  'raw',
  'text',
  'queryparam',
] as const

type Format = (typeof FORMATS)[number]

const FORMAT_DESC: Record<Format, string> = {
  csv: '단순 쉼표 구분 (기본)',
  sqlstring: "SQL IN 절 — 'v1','v2'",
  sqlin: "SQL IN(...) 괄호 포함 — ('v1','v2')",
  json: 'JSON 배열 — ["v1","v2"]',
  regex: '정규식 OR — v1|v2',
  pipe: '파이프 구분 — v1|v2',
  glob: 'Glob 패턴 — {v1,v2}',
  raw: '이스케이프 없음',
  text: 'label 값 그대로',
  queryparam: 'URL 쿼리 파라미터',
}

function applyFormat(varName: string, value: string[], format: Format): string {
  const template = `\${${varName}:${format}}`
  return interpolate(template, {
    variables: { [varName]: value },
    builtins: {},
    functions: {},
  })
}

export function FormatTab() {
  const [rawValues, setRawValues] = useState('seoul, busan, daegu')
  const [varName, setVarName] = useState('city')

  const values = rawValues
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Input */}
      <div className="flex gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Variable name</label>
          <input
            className="font-mono text-sm bg-gray-50 border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 w-32"
            value={varName}
            onChange={(e) => setVarName(e.target.value || 'city')}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Values (comma-separated)</label>
          <input
            className="w-full font-mono text-sm bg-gray-50 border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            value={rawValues}
            onChange={(e) => setRawValues(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left font-medium w-36">Format</th>
              <th className="px-4 py-2 text-left font-medium">Template</th>
              <th className="px-4 py-2 text-left font-medium">Output</th>
              <th className="px-4 py-2 text-left font-medium w-48 text-gray-400">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 font-mono">
            {FORMATS.map((fmt) => {
              const tmpl = `\${${varName}:${fmt}}`
              const out = values.length > 0 ? applyFormat(varName, values, fmt) : '—'
              return (
                <tr key={fmt} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs">
                      {fmt}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{tmpl}</td>
                  <td className="px-4 py-2 text-xs text-gray-900">{out}</td>
                  <td className="px-4 py-2 text-xs text-gray-400 font-sans">{FORMAT_DESC[fmt]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Single-value note */}
      <div className="rounded border border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
        <strong className="text-gray-700">단일값 기본:</strong> 포맷 미지정 시 → raw.{' '}
        <strong className="text-gray-700">다중값 기본:</strong> 포맷 미지정 시 → csv.
      </div>
    </div>
  )
}
