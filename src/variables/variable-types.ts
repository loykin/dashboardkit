import { defineVariableType } from '../schema'
import type { VariableOption } from '../schema'

function valuesFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function option(value: string): VariableOption {
  return { label: value, value }
}

export const constantVariableType = defineVariableType({
  id: 'constant',
  name: 'Constant',
  optionsSchema: {},
  async resolve(config) {
    return valuesFromUnknown(config.defaultValue).map(option)
  },
})

export const customVariableType = defineVariableType({
  id: 'custom',
  name: 'Custom',
  optionsSchema: {},
  async resolve(config, options) {
    const record = options as Record<string, unknown>
    const values = valuesFromUnknown(record['values'] ?? record['options'] ?? config.defaultValue)
    return values.map(option)
  },
})

export const textboxVariableType = defineVariableType({
  id: 'textbox',
  name: 'Textbox',
  optionsSchema: {},
  async resolve(config) {
    return valuesFromUnknown(config.defaultValue).map(option)
  },
})

export const intervalVariableType = defineVariableType({
  id: 'interval',
  name: 'Interval',
  optionsSchema: {},
  async resolve(config, options) {
    const record = options as Record<string, unknown>
    const values = valuesFromUnknown(record['values'] ?? config.defaultValue)
    const intervals = values.length > 0 ? values : ['1m', '5m', '15m', '1h', '6h', '1d']
    return intervals.map(option)
  },
})

export const queryVariableType = defineVariableType({
  id: 'query',
  name: 'Query',
  optionsSchema: {},
  async resolve(config, _options, ctx) {
    const request = config.dataRequest
    if (!request?.query || typeof request.query !== 'string') return []

    const datasource = ctx.datasourcePlugins[request.uid]
    if (!datasource?.metricFindQuery) return []

    return datasource.metricFindQuery(request.query, ctx.variables)
  },
})

export const builtinVariableTypes = [
  constantVariableType,
  customVariableType,
  textboxVariableType,
  intervalVariableType,
  queryVariableType,
] as const
