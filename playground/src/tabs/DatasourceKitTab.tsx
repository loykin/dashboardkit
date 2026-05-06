import { useMemo, useState } from 'react'
import { createDatasourceExecutor, defineDatasource } from '@loykin/datasourcekit'
import type { QueryResult } from '@loykin/datasourcekit'

type QueryKind = 'orders' | 'revenue' | 'countries'

const rows = [
  { country: 'KR', product: 'Dashboard', orders: 42, revenue: 12800 },
  { country: 'US', product: 'Builder', orders: 31, revenue: 18400 },
  { country: 'JP', product: 'Viewer', orders: 18, revenue: 9200 },
  { country: 'KR', product: 'Reports', orders: 16, revenue: 7400 },
]

const datasource = defineDatasource({
  uid: 'sales-api',
  type: 'mock-sales',
  options: { region: 'ap-northeast' },

  async queryData(request, context): Promise<QueryResult> {
    const country = String(context.variables?.['country'] ?? 'all')
    const filtered = country === 'all' ? rows : rows.filter((row) => row.country === country)

    if (request.query === 'revenue') {
      return {
        columns: [{ name: 'country', type: 'string' }, { name: 'revenue', type: 'number' }],
        rows: filtered.map((row) => [row.country, row.revenue]),
        meta: { region: context.datasourceOptions.region, source: context.meta?.['source'] },
      }
    }

    if (request.query === 'countries') {
      return {
        columns: [{ name: 'country', type: 'string' }],
        rows: [...new Set(rows.map((row) => row.country))].map((country) => [country]),
      }
    }

    return {
      columns: [
        { name: 'country', type: 'string' },
        { name: 'product', type: 'string' },
        { name: 'orders', type: 'number' },
      ],
      rows: filtered.map((row) => [row.country, row.product, row.orders]),
      meta: { region: context.datasourceOptions.region, source: context.meta?.['source'] },
    }
  },

  variable: {
    async metricFindQuery() {
      return [
        { label: 'All', value: 'all' },
        ...[...new Set(rows.map((row) => row.country))].map((country) => ({
          label: country,
          value: country,
        })),
      ]
    },
  },

  schema: {
    async listNamespaces() {
      return [
        { id: 'sales', name: 'Sales', kind: 'schema' },
        { id: 'sales.orders', name: 'Orders', kind: 'table', parentId: 'sales' },
      ]
    },
    async listFields(request) {
      if (request.namespaceId !== 'sales.orders') return []
      return [
        { name: 'country', type: 'string' },
        { name: 'product', type: 'string' },
        { name: 'orders', type: 'number' },
        { name: 'revenue', type: 'number' },
      ]
    },
  },

  connector: {
    configSchema: {},
    async healthCheck(options) {
      return { ok: true, message: `Connected to ${String(options.region)}` }
    },
  },
})

const executor = createDatasourceExecutor({ datasources: [datasource as never] })

function ResultTable({ result }: { result: QueryResult | null }) {
  if (!result) return <p className="text-xs text-gray-400">Run a query to see rows.</p>
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {result.columns.map((column) => (
            <th key={column.name} className="border border-gray-200 bg-gray-100 px-2 py-1 text-left">
              {column.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className="border border-gray-200 px-2 py-1 font-mono">
                {String(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function DatasourceKitTab() {
  const [query, setQuery] = useState<QueryKind>('orders')
  const [country, setCountry] = useState('all')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [health, setHealth] = useState('')
  const [schema, setSchema] = useState<string[]>([])
  const [options, setOptions] = useState<string[]>([])

  const request = useMemo(() => ({
    id: 'preview',
    datasourceUid: 'sales-api',
    datasourceType: 'mock-sales',
    query,
  }), [query])

  async function runQuery() {
    const next = await executor.query(request, {
      variables: { country },
      meta: { source: 'playground-datasourcekit' },
    })
    setResult(next)
  }

  async function runCapabilities() {
    const [healthResult, namespaces, fields, variableOptions] = await Promise.all([
      executor.healthCheck('sales-api'),
      executor.listNamespaces('sales-api'),
      executor.listFields('sales-api', { namespaceId: 'sales.orders' }),
      datasource.variable?.metricFindQuery('countries', {
        datasourceOptions: datasource.options!,
        variables: {},
      }),
    ])
    setHealth(healthResult.message ?? (healthResult.ok ? 'OK' : 'Failed'))
    setSchema([...namespaces.map((item) => item.name), ...fields.map((item) => item.name)])
    setOptions((variableOptions ?? []).map((item) => `${item.label}=${item.value}`))
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-xl font-bold">DatasourceKit</h1>
      <p className="mb-6 text-sm text-gray-500">
        This page uses @loykin/datasourcekit directly. No dashboard engine, panel, grid, or dataRequests are involved.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-gray-600">
          Query
          <select
            className="mt-1 block rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value as QueryKind)}
          >
            <option value="orders">orders</option>
            <option value="revenue">revenue</option>
            <option value="countries">countries</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Variable
          <select
            className="mt-1 block rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="all">all</option>
            <option value="KR">KR</option>
            <option value="US">US</option>
            <option value="JP">JP</option>
          </select>
        </label>
        <button className="rounded bg-gray-900 px-3 py-2 text-sm text-white" onClick={runQuery}>
          Run query
        </button>
        <button className="rounded border border-gray-300 px-3 py-2 text-sm" onClick={runCapabilities}>
          Run capabilities
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <ResultTable result={result} />
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500">Health</p>
            <p className="mt-1 text-sm">{health || 'Not checked'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500">Schema</p>
            <p className="mt-1 text-sm font-mono">{schema.length ? schema.join(', ') : 'Not loaded'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-500">Variable Options</p>
            <p className="mt-1 text-sm font-mono">{options.length ? options.join(', ') : 'Not loaded'}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs font-mono text-gray-700">
        <div>const executor = createDatasourceExecutor({'{'} datasources: [datasource] {'}'})</div>
        <div>executor.query({'{'} id: 'preview', datasourceUid: 'sales-api', query {'}'}, {'{'} variables {'}'})</div>
      </div>
    </div>
  )
}
