const RELATIVE_RE = /^now(?:-(\d+)(ms|s|m|h|d|w))?(?:\/([smhdw]))?$/

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

function startOf(date: Date, unit: string): Date {
  const next = new Date(date)
  switch (unit) {
    case 'w': {
      next.setHours(0, 0, 0, 0)
      next.setDate(next.getDate() - next.getDay())
      return next
    }
    case 'd':
      next.setHours(0, 0, 0, 0)
      return next
    case 'h':
      next.setMinutes(0, 0, 0)
      return next
    case 'm':
      next.setSeconds(0, 0)
      return next
    case 's':
      next.setMilliseconds(0)
      return next
    default:
      return next
  }
}

export function parseRelativeTime(expr: string, now: Date = new Date()): Date {
  const trimmed = expr.trim()
  const match = RELATIVE_RE.exec(trimmed)
  if (!match) {
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`invalid time expression: ${expr}`)
    }
    return parsed
  }

  const amount = match[1] ? Number.parseInt(match[1], 10) : 0
  const unit = match[2]
  const roundUnit = match[3]
  const date = new Date(now)

  if (unit && amount > 0) {
    date.setTime(date.getTime() - amount * UNIT_MS[unit])
  }

  return roundUnit ? startOf(date, roundUnit) : date
}

export function parseTimeRange(
  range: { from: string; to: string },
  now: Date = new Date(),
): { from: Date; to: Date } {
  return {
    from: parseRelativeTime(range.from, now),
    to: parseRelativeTime(range.to, now),
  }
}
