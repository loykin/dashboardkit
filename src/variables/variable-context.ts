import { buildBuiltinMap } from '../builtins'
import type { BuiltinVariable } from '../builtins'

export function buildCtxBuiltins(
  timeRange: { from: string; to: string } | undefined,
  dashboard: { id: string; title: string },
  extraBuiltins: BuiltinVariable[] = [],
): Record<string, string> {
  return buildBuiltinMap(
    {
      timeRange: timeRange ?? {
        from: new Date().toISOString(),
        to: new Date().toISOString(),
      },
      dashboard,
    },
    extraBuiltins,
  )
}

export function flattenVariables(
  variables: Record<string, string | string[]>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
  )
}
