import { defineDatasource, definePanel } from '@loykin/dashboardkit'
import type { DashboardDatasourceQueryContext, QueryResult, VariableOption } from '@loykin/dashboardkit'

// ── Sales dataset ──────────────────────────────────────────────────────────────

const ROWS: [string, string, string, number][] = [
  ['KR', 'Web',    'Q1', 182], ['KR', 'Mobile', 'Q1', 210],
  ['KR', 'Web',    'Q2', 230], ['KR', 'Mobile', 'Q2', 270],
  ['KR', 'Web',    'Q3', 198], ['KR', 'Mobile', 'Q3', 245],
  ['US', 'Web',    'Q1', 350], ['US', 'Mobile', 'Q1', 290],
  ['US', 'Web',    'Q2', 410], ['US', 'Mobile', 'Q2', 380],
  ['US', 'Web',    'Q3', 430], ['US', 'Mobile', 'Q3', 360],
  ['JP', 'Web',    'Q1', 140], ['JP', 'Mobile', 'Q1', 170],
  ['JP', 'Web',    'Q2', 160], ['JP', 'Mobile', 'Q2', 195],
  ['JP', 'Web',    'Q3', 155], ['JP', 'Mobile', 'Q3', 185],
  ['EU', 'Web',    'Q1', 290], ['EU', 'Mobile', 'Q1', 240],
  ['EU', 'Web',    'Q2', 320], ['EU', 'Mobile', 'Q2', 275],
  ['EU', 'Web',    'Q3', 310], ['EU', 'Mobile', 'Q3', 265],
]

function filterRows(opts: DashboardDatasourceQueryContext) {
  return ROWS.filter(([country, platform, quarter]) => {
    const v = opts.variables
    if (v.country  && v.country  !== 'all' && v.country  !== country)  return false
    if (v.platform && v.platform !== 'all' && v.platform !== platform) return false
    return !(v.quarter && v.quarter !== 'all' && v.quarter !== quarter);

  })
}

function agg(rows: typeof ROWS, keyIdx: 0 | 1 | 2): [string, number][] {
  const map = new Map<string, number>()
  rows.forEach((r) => map.set(r[keyIdx], (map.get(r[keyIdx]) ?? 0) + r[3]))
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

// ── Panel plugins ──────────────────────────────────────────────────────────────

export const statPanel = definePanel({
  id: 'stat', name: 'Stat', optionsSchema: {},
  transform: (r: QueryResult[]) => {
    const result = r[0]
    if (!result?.rows[0]) return null
    const numIdx = result.columns.findIndex((c) => c.type === 'number')
    const strIdx = result.columns.findIndex((c) => c.type === 'string')
    const row = result.rows[0]
    // Always return [number, string] regardless of column order in the datasource
    return [row[numIdx >= 0 ? numIdx : 0], row[strIdx >= 0 ? strIdx : 1]]
  },
})

export const barPanel = definePanel({
  id: 'bar', name: 'Bar Chart', optionsSchema: {},
  transform: (r: QueryResult[]) => r[0]?.rows ?? [],
})

export const tablePanel = definePanel({
  id: 'table', name: 'Table', optionsSchema: {},
  transform: (r: QueryResult[]) => r[0]?.rows ?? [],
})

export const PANEL_TYPES = ['stat', 'bar', 'table'] as const

// ── Datasource ─────────────────────────────────────────────────────────────────

export type SalesOptions = { delayMs?: number }

export const salesDs = defineDatasource<SalesOptions>({
  uid: 'sales', type: 'sales', name: 'Sales (mock)',
  async queryData(request, opts) {
    const delay = (opts.datasourceOptions?.delayMs ?? 250) + Math.random() * 50
    await new Promise((r) => setTimeout(r, delay))
    const filtered = filterRows(opts)
    const by = String(request.options?.['by'] ?? 'country')

    if (by === 'country')  return { columns: [{ name: 'Country',  type: 'string' }, { name: 'Revenue', type: 'number' }], rows: agg(filtered, 0) }
    if (by === 'platform') return { columns: [{ name: 'Platform', type: 'string' }, { name: 'Revenue', type: 'number' }], rows: agg(filtered, 1) }
    if (by === 'quarter')  return { columns: [{ name: 'Quarter',  type: 'string' }, { name: 'Revenue', type: 'number' }], rows: agg(filtered, 2) }

    if (by === 'total') {
      const total = filtered.reduce((s, r) => s + r[3], 0)
      return { columns: [{ name: 'Label', type: 'string' }, { name: 'Revenue', type: 'number' }], rows: [['Total Revenue', total]] }
    }

    return {
      columns: [
        { name: 'Country', type: 'string' }, { name: 'Platform', type: 'string' },
        { name: 'Quarter', type: 'string' }, { name: 'Revenue',  type: 'number' },
      ],
      rows: filtered,
    }
  },

  variable: {
    async metricFindQuery(query: string): Promise<VariableOption[]> {
      if (query === 'countries') return ['All', 'KR', 'US', 'JP', 'EU'].map((v) => ({ label: v, value: v.toLowerCase() === 'all' ? 'all' : v }))
      if (query === 'platforms') return ['All', 'Web', 'Mobile'].map((v) => ({ label: v, value: v.toLowerCase() === 'all' ? 'all' : v }))
      if (query === 'quarters')  return ['All', 'Q1', 'Q2', 'Q3'].map((v) => ({ label: v, value: v.toLowerCase() === 'all' ? 'all' : v }))
      return []
    },
  },

  editor: {
    querySchema: {
      by: {
        type: 'select',
        label: 'Group by',
        description: 'Dimension to aggregate data by',
        default: 'country',
        choices: [
          { label: 'Country',  value: 'country'  },
          { label: 'Platform', value: 'platform' },
          { label: 'Quarter',  value: 'quarter'  },
          { label: 'Total',    value: 'total'    },
          { label: 'Detail',   value: 'detail'   },
        ],
      },
    },
  },

  connector: {
    configSchema: {
      delayMs: {
        type: 'number',
        label: 'Simulated query delay (ms)',
        description: 'Artificial latency to simulate a real network call',
        default: 250,
        min: 0,
        max: 2000,
        integer: true,
      },
    },
    defaultConfig: { delayMs: 250 },
    async healthCheck(options) {
      await new Promise((r) => setTimeout(r, 200))
      return { ok: true, message: `Sales mock datasource OK — delay: ${options.delayMs ?? 250}ms` }
    },
  },
})
