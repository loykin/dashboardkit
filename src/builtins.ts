// ─── Built-in System Types ───────────────────────────────────────────────────────

export interface BuiltinContext {
  timeRange: { from: string; to: string } // ISO 8601 strings
  dashboard: { id: string; title: string }
}

export interface BuiltinVariable {
  name: string // name without the $__ prefix
  description: string
  resolve: (ctx: BuiltinContext) => string
}

export interface BuiltinFunction {
  name: string // name without the $__ prefix
  description: string
  call: (args: string[], ctx: BuiltinContext) => string
}

// ─── Interval Parsing Utility ────────────────────────────────────────────────────

interface ParsedInterval {
  amount: number
  unit: string // time unit
  ms: number
}

const INTERVAL_UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

export function parseInterval(interval: string): ParsedInterval {
  const m = /^(\d+)(ms|s|m|h|d|w)$/.exec(interval.trim())
  if (!m) return { amount: 1, unit: 'm', ms: 60_000 }
  const amount = parseInt(m[1], 10)
  const unit = m[2]
  return { amount, unit, ms: amount * (INTERVAL_UNITS[unit] ?? 60_000) }
}

export function calculateInterval(
  timeRange: { from: string; to: string },
  maxDataPoints = 500,
): string {
  const fromMs = new Date(timeRange.from).getTime()
  const toMs = new Date(timeRange.to).getTime()
  const rangeMs = Math.max(toMs - fromMs, 1)
  const intervalMs = Math.ceil(rangeMs / maxDataPoints)

  if (intervalMs < 1_000) return `${intervalMs}ms`
  if (intervalMs < 60_000) return `${Math.ceil(intervalMs / 1_000)}s`
  if (intervalMs < 3_600_000) return `${Math.ceil(intervalMs / 60_000)}m`
  if (intervalMs < 86_400_000) return `${Math.ceil(intervalMs / 3_600_000)}h`
  return `${Math.ceil(intervalMs / 86_400_000)}d`
}

// ─── Engine Built-in Variables (defaults) ────────────────────────────────────────

export const ENGINE_BUILTIN_VARIABLES: BuiltinVariable[] = [
  {
    name: 'from',
    description: 'Time range start as ms epoch string',
    resolve: ({ timeRange }) => String(new Date(timeRange.from).getTime()),
  },
  {
    name: 'to',
    description: 'Time range end as ms epoch string',
    resolve: ({ timeRange }) => String(new Date(timeRange.to).getTime()),
  },
  {
    name: 'fromISO',
    description: 'Time range start in ISO 8601',
    resolve: ({ timeRange }) => timeRange.from,
  },
  {
    name: 'toISO',
    description: 'Time range end in ISO 8601',
    resolve: ({ timeRange }) => timeRange.to,
  },
  {
    name: 'interval',
    description: 'Auto-calculated interval (e.g. 5m)',
    resolve: ({ timeRange }) => calculateInterval(timeRange),
  },
  {
    name: 'intervalMs',
    description: 'Auto-calculated interval in ms',
    resolve: ({ timeRange }) => String(parseInterval(calculateInterval(timeRange)).ms),
  },
  {
    name: 'dashboard',
    description: 'Dashboard title',
    resolve: ({ dashboard }) => dashboard.title,
  },
]

// ─── Build ctx.builtins Map ───────────────────────────────────────────────────────

/**
 * Used by the engine to build ctx.builtins before calling interpolate().
 * userDefined comes from createDashboardEngine.builtinVariables.
 * If names collide, userDefined overrides ENGINE_BUILTIN_VARIABLES.
 */
export function buildBuiltinMap(
  builtinCtx: BuiltinContext,
  userDefined: BuiltinVariable[] = [],
): Record<string, string> {
  const map: Record<string, string> = {}

  for (const b of ENGINE_BUILTIN_VARIABLES) {
    map[b.name] = b.resolve(builtinCtx)
  }
  for (const b of userDefined) {
    map[b.name] = b.resolve(builtinCtx)
  }

  return map
}
