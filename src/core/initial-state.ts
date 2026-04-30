import type { DashboardConfig, DashboardStateSnapshot } from '../schema'

export interface DashboardInitialStateSources {
  defaults?: Partial<DashboardStateSnapshot>
  saved?: Partial<DashboardStateSnapshot>
  url?: Partial<DashboardStateSnapshot>
}

export interface DashboardInitialStateResolver {
  (sources: DashboardInitialStateSources): DashboardStateSnapshot
}

function defaultVariableValue(config: DashboardConfig['variables'][number]): string | string[] {
  return config.defaultValue ?? (config.multi ? [] : '')
}

export function buildDefaultDashboardState(config: DashboardConfig): DashboardStateSnapshot {
  const variables: Record<string, string | string[]> = {}
  for (const variable of config.variables) {
    variables[variable.name] = defaultVariableValue(variable)
  }

  return {
    variables,
    ...(config.timeRange !== undefined ? { timeRange: config.timeRange } : {}),
    ...(config.refresh !== undefined ? { refresh: config.refresh } : {}),
  }
}

export function mergeDashboardStateSnapshots(
  ...snapshots: Array<Partial<DashboardStateSnapshot> | undefined>
): DashboardStateSnapshot {
  const variables: Record<string, string | string[]> = {}
  let timeRange: DashboardStateSnapshot['timeRange']
  let refresh: DashboardStateSnapshot['refresh']

  for (const snapshot of snapshots) {
    if (!snapshot) continue
    if (snapshot.variables) Object.assign(variables, snapshot.variables)
    if (snapshot.timeRange !== undefined) timeRange = snapshot.timeRange
    if (snapshot.refresh !== undefined) refresh = snapshot.refresh
  }

  return {
    variables,
    ...(timeRange !== undefined ? { timeRange } : {}),
    ...(refresh !== undefined ? { refresh } : {}),
  }
}

export function resolveDashboardInitialState(
  sources: DashboardInitialStateSources,
): DashboardStateSnapshot {
  return mergeDashboardStateSnapshots(sources.defaults, sources.saved, sources.url)
}
