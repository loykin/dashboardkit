import { useMemo, useState } from 'react'
import {
  builtinVariableTypes,
  createDashboardEngine,
  definePanel,
  queryResultToTableRows,
} from '@loykin/dashboardkit'
import { useLoadDashboard, usePanel, useVariable } from '@loykin/dashboardkit/react'
import { defineDatasource } from '@/lib/datasource-adapter'
import type {
  DashboardInput,
  RefParseResult,
  TemplateAdapter,
} from '@loykin/dashboardkit'

const S = {
  card: 'border border-gray-200 rounded-lg bg-gray-50 p-4',
  label: 'text-[10px] uppercase tracking-wide text-gray-500 font-semibold',
  code: 'font-mono text-xs bg-white border border-gray-200 rounded p-3',
  table: 'w-full text-xs border-collapse',
  th: 'text-left px-2 py-1 bg-gray-100 font-medium border border-gray-200',
  td: 'px-2 py-1 border border-gray-200 font-mono',
  btn: 'px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700',
}

const mustacheTemplateAdapter: TemplateAdapter = {
  parseRefs(template: string): RefParseResult {
    const refs: string[] = []
    const re = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z]+))?\s*}}/g
    let match: RegExpExecArray | null
    while ((match = re.exec(template)) !== null) {
      refs.push(match[1]!)
    }
    return { template, refs: [...new Set(refs)] }
  },
}

const panel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {},
  transform(results) {
    return results[0] ? queryResultToTableRows(results[0]).rows : []
  },
})

const dashboard: DashboardInput = {
  schemaVersion: 1,
  id: 'template-adapter',
  title: 'Template Adapter',
  variables: [
    { name: 'country', type: 'custom', options: { values: 'KR,US,JP' }, defaultValue: 'KR' },
    {
      name: 'city',
      type: 'query',
      dataRequest: { id: 'cities', uid: 'template-api', type: 'mock', query: '{{country}}' },
    },
  ],
  panels: [
    {
      id: 'orders',
      type: 'table',
      title: 'Orders for {{country}}',
      gridPos: { x: 0, y: 0, w: 12, h: 6 },
      dataRequests: [
        {
          id: 'main',
          uid: 'template-api',
          type: 'mock',
          query: 'orders',
          options: { country: '{{country}}', city: '{{city}}' },
        },
      ],
    },
  ],
}

export function TemplateAdapterTab() {
  const [queryLog, setQueryLog] = useState<string[]>([])

  const engine = useMemo(() => {
    const ds = defineDatasource({
      uid: 'template-api',
      type: 'mock',
      variable: {
        async metricFindQuery(_query, context) {
          const country = String(context.variables['country'] ?? 'KR')
          setQueryLog((current) => [`variable city <- ${country}`, ...current].slice(0, 8))
          return [
            { label: `${country}-north`, value: `${country}-north` },
            { label: `${country}-south`, value: `${country}-south` },
          ]
        },
      },
      async queryData(_request, context) {
        const country = String(context.variables['country'] ?? 'KR')
        const city = String(context.variables['city'] ?? '')
        setQueryLog((current) => [`panel orders <- ${country} / ${city}`, ...current].slice(0, 8))
        return {
          columns: [
            { name: 'country', type: 'string' },
            { name: 'city', type: 'string' },
            { name: 'orders', type: 'number' },
          ],
          rows: [
            [country, city, country === 'KR' ? 42 : country === 'US' ? 31 : 18],
          ],
        }
      },
    })

    return createDashboardEngine({
      datasourceAdapter: ds,
      panels: [panel],
      variableTypes: builtinVariableTypes,
      templateAdapter: mustacheTemplateAdapter,
    })
  }, [])

  useLoadDashboard(engine, dashboard)
  const country = useVariable(engine, 'country')
  const city = useVariable(engine, 'city')
  const panelState = usePanel(engine, 'orders')
  const rows = (panelState.data as unknown[][] | null) ?? []

  const setCountry = (value: string) => engine.setVariable('country', value)

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold mb-1">Template Adapter</h1>
        <p className="text-sm text-gray-500">
          Custom <code className="bg-gray-100 px-1 rounded">parseRefs()</code> adapter wired into variable DAG and panel refresh.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={S.card}>
          <div className={S.label}>Adapter</div>
          <pre className={`${S.code} mt-2 overflow-x-auto`}>
{`/{{\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*}}/g

query variable: {{country}}
panel options:  {{country}}, {{city}}`}
          </pre>
        </div>

        <div className={S.card}>
          <div className={S.label}>Variables</div>
          <div className="mt-3 flex gap-2">
            {['KR', 'US', 'JP'].map((value) => (
              <button
                key={value}
                className={`${S.btn} ${country.value === value ? '' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                onClick={() => setCountry(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className={S.label}>country</div>
              <div className="font-mono mt-1">{String(country.value ?? '')}</div>
            </div>
            <div>
              <div className={S.label}>city</div>
              <div className="font-mono mt-1">{String(city.value ?? '')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className={S.card}>
        <div className={S.label}>Panel Data</div>
        <table className={`${S.table} mt-2`}>
          <thead>
            <tr>
              <th className={S.th}>country</th>
              <th className={S.th}>city</th>
              <th className={S.th}>orders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={S.td}>{String(cell ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={S.card}>
        <div className={S.label}>Execution Log</div>
        <div className="mt-2 space-y-1">
          {queryLog.map((line, index) => (
            <div key={`${line}-${index}`} className="font-mono text-xs text-gray-700">{line}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
