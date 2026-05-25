import { defineVariableType } from '../schema'
import type { VariableOption } from '../schema'

function valuesFromUnknown(value: unknown): VariableOption[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!item) return []
      if (typeof item === 'object' && 'value' in item) {
        const v = String((item as Record<string, unknown>).value)
        if (!v) return []
        const label = 'label' in item ? String((item as Record<string, unknown>).label) : v
        return [{ label, value: v }]
      }
      const s = String(item)
      return s ? [{ label: s, value: s }] : []
    })
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => ({ label: v, value: v }))
  }
  return []
}

export const constantVariableType = defineVariableType({
  id: 'constant',
  name: 'Constant',
  optionsSchema: {},
  async resolve(config) {
    return valuesFromUnknown(config.defaultValue)
  },
})

export const customVariableType = defineVariableType({
  id: 'custom',
  name: 'Custom',
  optionsSchema: {},
  async resolve(config, options) {
    const record = options as Record<string, unknown>
    return valuesFromUnknown(record['values'] ?? record['options'] ?? config.defaultValue)
  },
})

export const textboxVariableType = defineVariableType({
  id: 'textbox',
  name: 'Textbox',
  optionsSchema: {},
  async resolve(config) {
    return valuesFromUnknown(config.defaultValue)
  },
})

export const intervalVariableType = defineVariableType({
  id: 'interval',
  name: 'Interval',
  optionsSchema: {},
  async resolve(config, options) {
    const record = options as Record<string, unknown>
    const values = valuesFromUnknown(record['values'] ?? config.defaultValue)
    if (values.length > 0) return values
    return ['1m', '5m', '15m', '1h', '6h', '1d'].map((v) => ({ label: v, value: v }))
  },
})

export const queryVariableType = defineVariableType({
  id: 'query',
  name: 'Query',
  optionsSchema: {},
  async resolve(config, _options, ctx) {
    const request = config.dataRequest
    if (!request?.query || typeof request.query !== 'string') return []

    if (ctx.queryVariableOptions) return ctx.queryVariableOptions(request)
    return []
  },
})

// ─── Datetime Variable ────────────────────────────────────────────────────────
// Encodes a time range as "from|to" (e.g. "now-1h|now").
// Use engine.setTimeRange() or engine.setVariable(name, "now-6h|now") to update.
// Panels that use a datetime variable will receive it as query context timeRange.

export const datetimeVariableType = defineVariableType({
  id: 'datetime',
  name: 'Date & Time Range',
  optionsSchema: {},
  async resolve(config) {
    const val = String(config.defaultValue ?? 'now-1h|now')
    return [{ label: val, value: val }]
  },
})

// ─── Refresh Variable ─────────────────────────────────────────────────────────
// Represents an auto-refresh interval selection.
// Value is a duration string ('', '5s', '30s', '1m', '5m', '1h').
// Empty string means "off". Wire to engine.setRefresh() or use Universal Variable.

export const refreshVariableType = defineVariableType({
  id: 'refresh',
  name: 'Auto Refresh Interval',
  optionsSchema: {},
  async resolve(config, options) {
    const record = options as Record<string, unknown>
    const values = valuesFromUnknown(record['values'] ?? config.defaultValue)
    if (values.length > 0) return values
    return ['', '5s', '10s', '30s', '1m', '5m', '15m', '1h'].map((v) => ({ label: v || 'Off', value: v }))
  },
})

export const builtinVariableTypes = [
  constantVariableType,
  customVariableType,
  textboxVariableType,
  intervalVariableType,
  queryVariableType,
  datetimeVariableType,
  refreshVariableType,
] as const
