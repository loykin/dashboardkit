import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { buildVariableDAG } from '../query'
import { parseRefs } from '../query'
import type { BuiltinVariable } from './builtins'
import type {
  AuthContext,
  DashboardConfig,
  DashboardStateStore,
  DataRequestConfig,
  VariableConfig,
  VariableOption,
  VariableReadiness,
  VariableState,
} from '../schema'
import type {
  DatasourcePluginDef,
  VariableResolveContext,
  VariableTypePluginDef,
} from '../schema'
import { buildCtxBuiltins } from './variable-context'
import { createDatasourceRegistry } from '../datasources'

export interface VariableEngineOptions {
  variableTypes: VariableTypePluginDef[]
  datasourcePlugins: DatasourcePluginDef[]
  builtinVariables?: BuiltinVariable[]
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
  if (!request?.query) return []
  return parseRefs(JSON.stringify(request.query)).refs
}

export function createVariableEngine(options: VariableEngineOptions): VariableEngine {
  const vtMap = new Map(options.variableTypes.map((v) => [v.id, v]))
  const datasourceRegistry = createDatasourceRegistry(options.datasourcePlugins)

  let sortedVarNames: string[] = []
  let variableConfigs: VariableConfig[] = []

  const store: StoreApi<Record<string, VariableState>> = createStore<Record<string, VariableState>>(() => ({}))

  function configuredVariables(): Record<string, string | string[]> {
    // The state store is the single source of truth, but the variable engine
    // only owns variables declared by the loaded DashboardConfig. Unknown
    // URL/state values are preserved in the store and excluded from query ctx.
    const snapshot = options.stateStore.getSnapshot()
    const names = new Set(variableConfigs.map((v) => v.name))
    const variables: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(snapshot.variables)) {
      if (names.has(name)) variables[name] = value
    }
    return variables
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
        builtins: buildCtxBuiltins(snapshot.timeRange, dashboard, options.builtinVariables ?? []),
        variables: configuredVariables(),
        dashboard,
        authContext: options.getAuthContext(),
      }

      const resolvedOptions = await vtDef.resolve(vcfg, vcfg.options as never, resolveCtx)
      const cur = snapshot.variables[name]
      const curArr = Array.isArray(cur) ? cur : cur ? [cur] : []

      let newValue: string | string[]
      if (curArr.length > 0) {
        newValue = vcfg.multi ? curArr : curArr[0]!
      } else if (vcfg.defaultValue !== null && vcfg.defaultValue !== undefined) {
        newValue = vcfg.defaultValue
      } else {
        newValue = vcfg.multi
          ? (resolvedOptions[0] ? [resolvedOptions[0].value] : [])
          : (resolvedOptions[0]?.value ?? '')
      }

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
    load(variables) {
      variableConfigs = variables
      sortedVarNames = buildVariableDAG(
        variables.map((v) => ({
          name: v.name,
          ...(v.dataRequest?.query !== undefined ? { query: JSON.stringify(v.dataRequest.query) } : {}),
        })),
      )

      const snapshot = options.stateStore.getSnapshot()
      const initState: Record<string, VariableState> = {}
      for (const v of variables) {
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

    async refreshDownstream(changedNames) {
      const downstream = new Set<string>()
      for (const changed of changedNames) {
        const idx = sortedVarNames.indexOf(changed)
        if (idx === -1) continue
        for (const name of sortedVarNames.slice(idx + 1)) {
          const vcfg = variableConfigs.find((v) => v.name === name)
          if (requestRefs(vcfg?.dataRequest).includes(changed)) downstream.add(name)
        }
      }

      const changed: string[] = []
      for (const name of downstream) {
        if (await resolveOne(name)) changed.push(name)
      }
      return changed
    },

    getVariables() {
      return configuredVariables()
    },

    getBuiltins() {
      const cfg = options.getDashboardConfig()
      const dashboard = cfg ? { id: cfg.id, title: cfg.title } : { id: '', title: '' }
      return buildCtxBuiltins(options.stateStore.getSnapshot().timeRange, dashboard, options.builtinVariables ?? [])
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
