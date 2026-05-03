import type { BuiltinFunction } from '../variables'

// ─── Parser Output Types ────────────────────────────────────────────────────────

export interface TemplateToken {
  kind: 'variable' | 'builtin-var' | 'builtin-func'
  raw: string // full original token (used to locate the substitution position)
  name: string // variable name or function name
  format?: string // format specifier (only for variable tokens)
  args?: string[] // function arguments (only for builtin-func tokens)
}

export interface ParseResult {
  tokens: TemplateToken[] // list of found tokens (in order)
  refs: string[] // deduplicated variable names for DAG edge construction
  template: string // original template string
}

// ─── Regular Expressions (in priority order) ────────────────────────────────────
// Processing order: builtin-func → builtin-var → ${name:format} → $name
// This order ensures $__name is not accidentally matched by the $name rule.
const BUILTIN_FUNC_RE = /\$__([a-zA-Z][a-zA-Z0-9]*)\(([^)]*)\)/g
const BUILTIN_VAR_RE = /\$__([a-zA-Z][a-zA-Z0-9]*)/g
const VAR_BRACED_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z]+))?}/g
const VAR_PLAIN_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g

/**
 * Extract all tokens from a template string.
 * builtin-var / builtin-func are NOT included in refs (they are not DAG nodes).
 */
export function parseRefs(template: string): ParseResult {
  // Sort by position (index) to process all regex matches in a single pass
  type RawMatch = { index: number; token: TemplateToken }
  const matches: RawMatch[] = []

  const collect = (re: RegExp, handler: (m: RegExpExecArray) => TemplateToken) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(template)) !== null) {
      matches.push({ index: m.index, token: handler(m) })
    }
  }

  collect(BUILTIN_FUNC_RE, (m) => ({
    kind: 'builtin-func',
    raw: m[0],
    name: m[1],
    args: m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }))

  collect(BUILTIN_VAR_RE, (m) => ({
    kind: 'builtin-var',
    raw: m[0],
    name: m[1],
  }))

  collect(VAR_BRACED_RE, (m) => ({
    kind: 'variable',
    raw: m[0],
    name: m[1],
    format: m[2] ?? undefined,
  }))

  collect(VAR_PLAIN_RE, (m) => ({
    kind: 'variable',
    raw: m[0],
    name: m[1],
  }))

  // Multiple regex patterns can match the same position.
  // Keep the first match (highest priority) and skip overlapping spans.
  matches.sort((a, b) => a.index - b.index || b.token.raw.length - a.token.raw.length)

  const tokens: TemplateToken[] = []
  let covered = 0
  for (const { index, token } of matches) {
    if (index < covered) continue // already covered by a longer token
    tokens.push(token)
    covered = index + token.raw.length
  }

  const refs = [...new Set(tokens.filter((t) => t.kind === 'variable').map((t) => t.name))]

  return { tokens, refs, template }
}

// ─── Interpolator ───────────────────────────────────────────────────────────────

export type VariableFormatter = (value: string | string[], varName: string) => string

export interface InterpolateContext {
  variables: Record<string, string | string[]> // user-defined variables
  builtins: Record<string, string> // built-in variables ($__from, etc.)
  functions: Record<string, BuiltinFunction> // built-in functions ($__timeFilter, etc.)
  formatters?: Record<string, VariableFormatter> // custom format specifiers
}

/**
 * Replace all tokens in the template string with values from ctx.
 */
export function interpolate(template: string, ctx: InterpolateContext): string {
  const { tokens } = parseRefs(template)
  let result = template

  // Replace from the end so earlier indices are not disturbed
  // tokens are in forward order, so process a reversed copy
  const reversed = [...tokens].reverse()

  for (const token of reversed) {
    const idx = result.lastIndexOf(token.raw)
    if (idx === -1) continue

    let replacement: string

    if (token.kind === 'variable') {
      const val = ctx.variables[token.name]
      if (val === undefined || val === null) {
        replacement = ''
      } else if (token.format) {
        const custom = ctx.formatters?.[token.format]
        replacement = custom ? custom(val, token.name) : applyFormat(val, token.format, token.name)
      } else {
        replacement = Array.isArray(val) ? val.join(',') : val
      }
    } else if (token.kind === 'builtin-var') {
      const val = ctx.builtins[token.name]
      if (val === undefined) {
        console.warn(`[dashboardkit] Unknown built-in variable: $__${token.name}`)
        replacement = ''
      } else {
        replacement = val
      }
    } else {
      // builtin-func
      const fn = ctx.functions[token.name]
      if (!fn) {
        // If function is not found, keep the original token as-is (do not throw)
        replacement = token.raw
      } else {
        const builtinCtx = {
          timeRange: {
            from: ctx.builtins['fromISO'] ?? '',
            to: ctx.builtins['toISO'] ?? '',
          },
          dashboard: { id: '', title: ctx.builtins['dashboard'] ?? '' },
        }
        replacement = fn.call(token.args ?? [], builtinCtx)
      }
    }

    result = result.slice(0, idx) + replacement + result.slice(idx + token.raw.length)
  }

  return result
}

export function interpolateVariables(
  template: string,
  variables: Record<string, string | string[]>,
  builtins: Record<string, string> = {},
  formatters: Record<string, VariableFormatter> = {},
): string {
  return interpolate(template, { variables, builtins, functions: {}, formatters })
}

// ─── Format Specifiers ──────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * varName is used as the URL key in queryparam format.
 */
function applyFormat(value: string | string[], format: string, varName: string): string {
  const arr = Array.isArray(value) ? value : [value]
  switch (format) {
    case 'csv':
      return arr.join(',')
    case 'sqlstring':
      return arr.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
    case 'sqlin':
      return `(${arr.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`
    case 'json':
      return JSON.stringify(arr)
    case 'regex':
      return arr.map(escapeRegex).join('|')
    case 'pipe':
      return arr.join('|')
    case 'glob':
      return `{${arr.join(',')}}`
    case 'raw':
      return arr.join(',')
    case 'text':
      // Using VariableOption.label requires the caller to pass a label array.
      // Return value as-is here (labels need separate tracking at resolve time).
      return arr.join(',')
    case 'queryparam':
      return arr.map((v) => `${varName}=${encodeURIComponent(v)}`).join('&')
    default:
      return arr.join(',') // unknown format → csv fallback
  }
}
