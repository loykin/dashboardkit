import type { QueryResult } from '../schema'

// Escapes a cell value for CSV (RFC 4180).
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function exportToCsv(rawData: QueryResult[]): string {
  if (rawData.length === 0) return ''

  // Build unified column list
  const colNames: string[] = []
  const seen = new Set<string>()
  for (const result of rawData) {
    for (const col of result.columns) {
      if (!seen.has(col.name)) {
        colNames.push(col.name)
        seen.add(col.name)
      }
    }
  }

  const lines: string[] = [colNames.map(csvCell).join(',')]

  for (const result of rawData) {
    const indices = colNames.map((name) => result.columns.findIndex((c) => c.name === name))
    for (const row of result.rows) {
      lines.push(indices.map((i) => csvCell(i === -1 ? null : row[i])).join(','))
    }
  }

  return lines.join('\n')
}
