import type { QueryResult } from '../schema'

// ─── Transform Types ─────────────────────────────────────────────────────────

export type TransformCalc = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first' | 'last'
export type FilterOp = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'contains' | 'startsWith'

export type PanelTransformConfig =
  | { type: 'merge'; by?: string }
  | { type: 'groupBy'; by: string; calc: TransformCalc }
  | { type: 'calculate'; alias: string; expr: string }
  | { type: 'sortBy'; field: string; order?: 'asc' | 'desc' }
  | { type: 'filterByValue'; field: string; op: FilterOp; threshold: unknown }
  | { type: 'rename'; from: string; to: string }
  | { type: 'limit'; count: number }

// ─── Internal Helpers ─────────────────────────────────────────────────────────

type ColDef = { name: string; type: string }

function colIdx(columns: ColDef[], name: string): number {
  return columns.findIndex((c) => c.name === name)
}

function resolveToken(token: string, row: unknown[], columns: ColDef[]): number | null {
  const num = Number(token)
  if (!Number.isNaN(num)) return num
  const idx = colIdx(columns, token)
  if (idx === -1) return null
  const val = Number(row[idx])
  return Number.isNaN(val) ? null : val
}

// Evaluates a simple binary arithmetic expression referencing column names.
// Supports +, -, *, / with two operands: `errors / total`, `a + 100`
function evalExpr(expr: string, row: unknown[], columns: ColDef[]): number | null {
  const match = /^(.+?)\s*([+\-*/])\s*(.+)$/.exec(expr.trim())
  if (!match) return resolveToken(expr.trim(), row, columns)
  const [, leftStr, op, rightStr] = match
  const left = resolveToken(leftStr!.trim(), row, columns)
  const right = resolveToken(rightStr!.trim(), row, columns)
  if (left === null || right === null) return null
  switch (op) {
    case '+': return left + right
    case '-': return left - right
    case '*': return left * right
    case '/': return right !== 0 ? left / right : null
  }
  return null
}

// ─── Individual Transforms ────────────────────────────────────────────────────

function applyMerge(results: QueryResult[], by?: string): QueryResult[] {
  if (results.length <= 1) return results

  // Build unified column list preserving insertion order
  const colMap = new Map<string, ColDef>()
  for (const r of results) {
    for (const c of r.columns) {
      if (!colMap.has(c.name)) colMap.set(c.name, c)
    }
  }
  const allColumns = [...colMap.values()]

  if (!by) {
    // Simple concat: project each result onto allColumns
    const rows: unknown[][] = []
    for (const result of results) {
      const indices = allColumns.map((c) => colIdx(result.columns, c.name))
      for (const row of result.rows) {
        rows.push(indices.map((i) => (i === -1 ? null : row[i])))
      }
    }
    return [{ columns: allColumns, rows }]
  }

  // Join by key column: accumulate one merged row per unique key
  const keyed = new Map<unknown, unknown[]>()
  for (const result of results) {
    const keyI = colIdx(result.columns, by)
    if (keyI === -1) continue
    const indices = allColumns.map((c) => colIdx(result.columns, c.name))
    for (const row of result.rows) {
      const key = row[keyI]
      const merged = keyed.get(key) ?? new Array<unknown>(allColumns.length).fill(null)
      for (let i = 0; i < indices.length; i++) {
        const srcI = indices[i]
        if (srcI !== -1 && merged[i] === null) merged[i] = row[srcI]
      }
      keyed.set(key, merged)
    }
  }
  return [{ columns: allColumns, rows: [...keyed.values()] }]
}

function applyGroupBy(results: QueryResult[], by: string, calc: TransformCalc): QueryResult[] {
  return results.map((result) => {
    const byI = colIdx(result.columns, by)
    if (byI === -1) return result

    const groups = new Map<unknown, unknown[][]>()
    for (const row of result.rows) {
      const key = row[byI]
      const g = groups.get(key) ?? []
      g.push(row as unknown[])
      groups.set(key, g)
    }

    const newCols: ColDef[] = result.columns.map((c) =>
      c.name === by ? c : { name: c.name, type: 'number' },
    )
    const newRows: unknown[][] = []
    for (const [key, groupRows] of groups) {
      newRows.push(
        result.columns.map((col, i) => {
          if (col.name === by) return key
          const vals = groupRows.map((r) => Number(r[i])).filter((v) => !Number.isNaN(v))
          switch (calc) {
            case 'sum': return vals.reduce((a, b) => a + b, 0)
            case 'avg': return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
            case 'min': return vals.length ? Math.min(...vals) : null
            case 'max': return vals.length ? Math.max(...vals) : null
            case 'count': return groupRows.length
            case 'first': return groupRows[0]?.[i] ?? null
            case 'last': return groupRows[groupRows.length - 1]?.[i] ?? null
          }
        }),
      )
    }
    return { columns: newCols, rows: newRows }
  })
}

function applyCalculate(results: QueryResult[], alias: string, expr: string): QueryResult[] {
  return results.map((result) => {
    const newCols: ColDef[] = [...result.columns, { name: alias, type: 'number' }]
    const newRows = result.rows.map((row) => [
      ...row,
      evalExpr(expr, row as unknown[], result.columns),
    ])
    return { columns: newCols, rows: newRows }
  })
}

function applySortBy(results: QueryResult[], field: string, order: 'asc' | 'desc' = 'asc'): QueryResult[] {
  return results.map((result) => {
    const fieldI = colIdx(result.columns, field)
    if (fieldI === -1) return result
    const sorted = [...result.rows].sort((a, b) => {
      const av = a[fieldI]
      const bv = b[fieldI]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return order === 'desc' ? -cmp : cmp
    })
    return { columns: result.columns, rows: sorted }
  })
}

function applyFilterByValue(
  results: QueryResult[],
  field: string,
  op: FilterOp,
  threshold: unknown,
): QueryResult[] {
  return results.map((result) => {
    const fieldI = colIdx(result.columns, field)
    if (fieldI === -1) return result
    const rows = result.rows.filter((row) => {
      const val = row[fieldI]
      switch (op) {
        case '>': return Number(val) > Number(threshold)
        case '<': return Number(val) < Number(threshold)
        case '>=': return Number(val) >= Number(threshold)
        case '<=': return Number(val) <= Number(threshold)
        case '==': return val === threshold
        case '!=': return val !== threshold
        case 'contains': return String(val).includes(String(threshold))
        case 'startsWith': return String(val).startsWith(String(threshold))
      }
    })
    return { columns: result.columns, rows }
  })
}

function applyRename(results: QueryResult[], from: string, to: string): QueryResult[] {
  return results.map((result) => ({
    ...result,
    columns: result.columns.map((c) => (c.name === from ? { ...c, name: to } : c)),
  }))
}

function applyLimit(results: QueryResult[], count: number): QueryResult[] {
  return results.map((result) => ({ ...result, rows: result.rows.slice(0, count) }))
}

// ─── Pipeline Runner ──────────────────────────────────────────────────────────

export function applyTransforms(
  results: QueryResult[],
  transforms: readonly PanelTransformConfig[],
): QueryResult[] {
  let current = results
  for (const t of transforms) {
    switch (t.type) {
      case 'merge':
        current = applyMerge(current, t.by)
        break
      case 'groupBy':
        current = applyGroupBy(current, t.by, t.calc)
        break
      case 'calculate':
        current = applyCalculate(current, t.alias, t.expr)
        break
      case 'sortBy':
        current = applySortBy(current, t.field, t.order)
        break
      case 'filterByValue':
        current = applyFilterByValue(current, t.field, t.op, t.threshold)
        break
      case 'rename':
        current = applyRename(current, t.from, t.to)
        break
      case 'limit':
        current = applyLimit(current, t.count)
        break
    }
  }
  return current
}
