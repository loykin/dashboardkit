import type { StoreApi } from 'zustand/vanilla'
import { createStore } from 'zustand/vanilla'
import { buildVariableDAG, parseRefs } from '../query'
import type {
  AuthContext,
  DashboardConfig,
  DashboardStateStore,
  DataRequestConfig,
  DatasourcePluginDef,
  VariableConfig,
  VariableOption,
  VariableReadiness,
  VariableResolveContext,
  VariableState,
  VariableTypePluginDef,
} from '../schema'
import { buildCtxBuiltins } from './variable-context'
import { createDashboardDatasourceExecutor, createDatasourceRegistry } from '../datasources'

export const ALL_OPTION_VALUE = '$__all'

export interface VariableEngineOptions {
  variableTypes: ReadonlyArray<VariableTypePluginDef>
  datasourcePlugins: DatasourcePluginDef[]
  stateStore: DashboardStateStore
  getAuthContext: () => AuthContext
  getDashboardConfig: () => DashboardConfig | null
  authorizeVariableQuery?: (
    cfg: DashboardConfig,
    vcfg: VariableConfig,
    request: DataRequestConfig,
  ) => Promise<void>
}

export interface VariableEngine {
  registerType(def: VariableTypePluginDef): void
  registerEngineVariable(config: VariableConfig): void
  load(variables: VariableConfig[]): void
  refresh(): Promise<string[]>
  refreshOne(name: string): Promise<boolean>
  refreshDownstream(changedNames: string[]): Promise<string[]>
  getVariables(): Record<string, string | string[]>
  getBuiltins(): Record<string, string>
  getState(): Record<string, VariableState>
  getVariableReadiness(names: readonly string[]): VariableReadiness
  subscribe(listener: () => void): () => void
  getSortedNames(): string[]
}

export function defaultVariableValue(v: VariableConfig): string | string[] {
  return v.defaultValue ?? (v.multi ? [] : '')
}

function valuesEqual(
  a: string | string[] | undefined,
  b: string | string[] | undefined,
): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
  }
  return a === b
}

function requestRefs(request: DataRequestConfig | undefined): string[] {
  if (!request) return []
  const queryText = request.query !== undefined ? JSON.stringify(request.query) : '{}'
  const optionsText = request.options !== undefined ? JSON.stringify(request.options) : '{}'
  return [...new Set([...parseRefs(queryText).refs, ...parseRefs(optionsText).refs])]
}

function requestRefText(request: DataRequestConfig): string {
  const queryText = request.query !== undefined ? JSON.stringify(request.query) : '{}'
  const optionsText = request.options !== undefined ? JSON.stringify(request.options) : '{}'
  return `${queryText}\n${optionsText}`
}

// ─── Sort ──────────────────────────────────────────────────────────────────────

function sortOptions(options: VariableOption[], sort: VariableConfig['sort']): VariableOption[] {
  if (!sort || sort === 'none') return options
  const sorted = [...options]
  switch (sort) {
    case 'alphaAsc':  return sorted.sort((a, b) => a.label.localeCompare(b.label))
    case 'alphaDesc': return sorted.sort((a, b) => b.label.localeCompare(a.label))
    case 'numericAsc':  return sorted.sort((a, b) => parseFloat(a.value) - parseFloat(b.value))
    case 'numericDesc': return sorted.sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
    default: return sorted
  }
}

// ─── Value selection ───────────────────────────────────────────────────────────

export function chooseVariableValue(
  config: VariableConfig,
  current: string | string[] | undefined,
  options: VariableOption[],
): string | string[] {
  const optionValues = new Set(options.map((o) => o.value))

  if (config.multi) {
    const curArr = Array.isArray(current) ? current : current ? [current] : []
    const validCurrent = curArr.filter((v) => optionValues.has(v))
    if (validCurrent.length > 0) return validCurrent

    const defaultArr = Array.isArray(config.defaultValue)
      ? config.defaultValue
      : config.defaultValue ? [config.defaultValue] : []
    const validDefault = defaultArr.filter((v) => optionValues.has(v))
    if (validDefault.length > 0) return validDefault

    return options[0] ? [options[0].value] : []
  }

  const curStr = Array.isArray(current) ? (current[0] ?? '') : (current ?? '')
  if (curStr && optionValues.has(curStr)) return curStr

  const defaultStr = Array.isArray(config.defaultValue)
    ? (config.defaultValue[0] ?? '')
    : (config.defaultValue ?? '')
  if (defaultStr && optionValues.has(defaultStr)) return defaultStr

  return options[0]?.value ?? ''
}

// ─── Engine ────────────────────────────────────────────────────────────────────

export function createVariableEngine(options: VariableEngineOptions): VariableEngine {
  const vtMap = new Map(options.variableTypes.map((v) => [v.id, v]))
  const datasourceRegistry = createDatasourceRegistry(options.datasourcePlugins)
  const datasourceExecutor = createDashboardDatasourceExecutor(datasourceRegistry)

  let sortedVarNames: string[] = []
  let variableConfigs: VariableConfig[] = []
  let engineScopedConfigs: VariableConfig[] = []

  const store: StoreApi<Record<string, VariableState>> = createStore<Record<string, VariableState>>(() => ({}))

  function configuredVariables(): Record<string, string | string[]> {
    const snapshot = options.stateStore.getSnapshot()
    const names = new Set(variableConfigs.map((v) => v.name))
    const variables: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(snapshot.variables)) {
      if (names.has(name)) variables[name] = value
    }
    return variables
  }

  // Expands $__all to allValue or array of concrete option values for datasource use
  function expandedVariables(): Record<string, string | string[]> {
    const raw = configuredVariables()
    const state = store.getState()
    const result: Record<string, string | string[]> = {}

    for (const [name, value] of Object.entries(raw)) {
      const vcfg = variableConfigs.find((v) => v.name === name)
      const isAll =
        value === ALL_OPTION_VALUE ||
        (Array.isArray(value) && value.length === 1 && value[0] === ALL_OPTION_VALUE)

      if (vcfg?.includeAll && isAll) {
        if (vcfg.allValue !== undefined) {
          result[name] = vcfg.allValue
        } else {
          result[name] = (state[name]?.options ?? [])
            .filter((o) => o.value !== ALL_OPTION_VALUE)
            .map((o) => o.value)
        }
      } else {
        result[name] = value
      }
    }

    return result
  }

  async function resolveOne(name: string): Promise<boolean> {
    const vcfg = variableConfigs.find((v) => v.name === name)
    if (!vcfg) return false

    const vtDef = vtMap.get(vcfg.type)
    if (!vtDef) {
      console.warn(`[dashboardkit] Unknown variable type: ${vcfg.type}`)
      return false
    }

    store.setState((s) => ({
      ...s,
      [name]: { ...s[name]!, loading: true, error: null, status: 'loading' },
    }))

    let changed = false
    try {
      const cfg = options.getDashboardConfig()
      const snapshot = options.stateStore.getSnapshot()
      const dashboard = cfg ? { id: cfg.id, title: cfg.title } : { id: '', title: '' }

      if (vcfg.dataRequest) {
        datasourceRegistry.getForRequest(vcfg.dataRequest)
        if (cfg) await options.authorizeVariableQuery?.(cfg, vcfg, vcfg.dataRequest)
      }

      const resolveCtx: VariableResolveContext = {
        datasourcePlugins: datasourceRegistry.toRecord(),
        builtins: buildCtxBuiltins(snapshot.timeRange, dashboard),
        variables: expandedVariables(),
        dashboard,
        authContext: options.getAuthContext(),
        queryVariableOptions(request) {
          return datasourceExecutor.metricFindQuery(request, {
            variables: expandedVariables(),
            ...(snapshot.timeRange !== undefined ? { timeRange: snapshot.timeRange } : {}),
            authContext: options.getAuthContext(),
            builtins: buildCtxBuiltins(snapshot.timeRange, dashboard),
          })
        },
      }

      let resolvedOptions = await vtDef.resolve(vcfg, vcfg.options, resolveCtx)

      // P4-2: sort before injecting All
      resolvedOptions = sortOptions(resolvedOptions, vcfg.sort)

      // P4-1: inject All option at top after sort
      if (vcfg.includeAll) {
        resolvedOptions = [{ label: 'All', value: ALL_OPTION_VALUE }, ...resolvedOptions]
      }

      // P1-2: choose valid value from resolved options
      const cur = snapshot.variables[name]
      const newValue = chooseVariableValue(vcfg, cur, resolvedOptions)

      store.setState((s) => ({
        ...s,
        [name]: {
          ...s[name]!,
          options: resolvedOptions,
          value: newValue,
          loading: false,
          error: null,
          status: 'success',
        },
      }))

      if (!valuesEqual(cur, newValue)) {
        options.stateStore.setPatch({ variables: { [name]: newValue } })
        changed = true
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      store.setState((s) => ({
        ...s,
        [name]: { ...s[name]!, loading: false, error, status: 'error' },
      }))
    }

    return changed
  }

  return {
    registerType(def) {
      vtMap.set(def.id, def)
    },

    registerEngineVariable(cfg) {
      const existing = engineScopedConfigs.findIndex((v) => v.name === cfg.name)
      if (existing >= 0) {
        engineScopedConfigs = engineScopedConfigs.map((v, i) => i === existing ? cfg : v)
      } else {
        engineScopedConfigs = [...engineScopedConfigs, cfg]
      }
    },

    load(dashboardVars) {
      const dashboardNames = new Set(dashboardVars.map((v) => v.name))
      const effective = [
        ...engineScopedConfigs.filter((v) => !dashboardNames.has(v.name)),
        ...dashboardVars,
      ]
      variableConfigs = effective
      sortedVarNames = buildVariableDAG(
        effective.map((v) => ({
          name: v.name,
          ...(v.dataRequest ? { query: requestRefText(v.dataRequest) } : {}),
        })),
      )

      const snapshot = options.stateStore.getSnapshot()
      const initState: Record<string, VariableState> = {}
      for (const v of effective) {
        initState[v.name] = {
          name: v.name,
          type: v.type,
          value: snapshot.variables[v.name] ?? defaultVariableValue(v),
          options: [],
          loading: false,
          error: null,
          status: 'idle',
        }
      }
      store.setState(initState, true)
    },

    async refresh() {
      const changed: string[] = []
      for (const name of sortedVarNames) {
        if (await resolveOne(name)) changed.push(name)
      }
      return changed
    },

    refreshOne(name) {
      return resolveOne(name)
    },

    // P0-2: transitive cascade using BFS over sorted variable order
    async refreshDownstream(changedNames) {
      const queue = [...changedNames]
      const visited = new Set(changedNames)
      const changed: string[] = []

      while (queue.length > 0) {
        const current = queue.shift()!
        const currentIndex = sortedVarNames.indexOf(current)
        if (currentIndex === -1) continue

        for (const name of sortedVarNames.slice(currentIndex + 1)) {
          if (visited.has(name)) continue
          const vcfg = variableConfigs.find((v) => v.name === name)
          if (!requestRefs(vcfg?.dataRequest).includes(current)) continue

          visited.add(name)
          const didChange = await resolveOne(name)
          if (didChange) {
            changed.push(name)
            queue.push(name)
          }
        }
      }

      return changed
    },

    getVariables() {
      return expandedVariables()
    },

    getBuiltins() {
      const cfg = options.getDashboardConfig()
      const dashboard = cfg ? { id: cfg.id, title: cfg.title } : { id: '', title: '' }
      return buildCtxBuiltins(options.stateStore.getSnapshot().timeRange, dashboard)
    },

    getState() {
      return store.getState()
    },

    getVariableReadiness(names) {
      const state = store.getState()
      const waiting: string[] = []
      const errors: Record<string, string> = {}

      for (const name of names) {
        const variable = state[name]
        if (!variable) {
          waiting.push(name)
          continue
        }
        if (variable.status === 'error' || variable.error) {
          errors[name] = variable.error ?? 'variable resolution failed'
          continue
        }
        if (variable.status !== 'success') {
          waiting.push(name)
        }
      }

      return {
        ready: waiting.length === 0 && Object.keys(errors).length === 0,
        waiting,
        errors,
      }
    },

    subscribe(listener) {
      return store.subscribe(listener)
    },

    getSortedNames() {
      return [...sortedVarNames]
    },
  }
}

export type { VariableOption }
