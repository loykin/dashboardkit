import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { buildVariableDAG } from '../dag'
import { parseRefs } from '../parser'
import type { BuiltinVariable } from '../builtins'
import type {
  AuthContext,
  DashboardConfig,
  DashboardStateStore,
  DataRequestConfig,
  VariableConfig,
  VariableOption,
  VariableState,
} from '../types'
import type {
  DatasourcePluginDef,
  VariableResolveContext,
  VariableTypePluginDef,
} from '../define'
import { buildCtxBuiltins } from './variable-context'

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
  const dsMap = new Map(options.datasourcePlugins.map((d) => [d.uid, d]))

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

  function getDatasourceDef(request: DataRequestConfig): DatasourcePluginDef {
    const dsDef = dsMap.get(request.uid)
    if (!dsDef) throw new Error(`datasource "${request.uid}" not registered in engine`)
    if (dsDef.type !== request.type) {
      throw new Error(`datasource "${request.uid}" type mismatch: expected "${request.type}", got "${dsDef.type}"`)
    }
    return dsDef
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
      [name]: { ...s[name]!, loading: true, error: null },
    }))

    let changed = false
    try {
      const cfg = options.getDashboardConfig()
      const snapshot = options.stateStore.getSnapshot()
      const dashboard = cfg ? { id: cfg.id, title: cfg.title } : { id: '', title: '' }

      if (vcfg.dataRequest) {
        getDatasourceDef(vcfg.dataRequest)
        if (cfg) await options.authorizeVariableQuery?.(cfg, vcfg, vcfg.dataRequest)
      }

      const resolveCtx: VariableResolveContext = {
        datasourcePlugins: Object.fromEntries(dsMap),
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
        [name]: { ...s[name]!, options: resolvedOptions, value: newValue, loading: false },
      }))

      if (!valuesEqual(cur, newValue)) {
        options.stateStore.setPatch({ variables: { [name]: newValue } })
        changed = true
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      store.setState((s) => ({
        ...s,
        [name]: { ...s[name]!, loading: false, error },
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

    subscribe(listener) {
      return store.subscribe(listener)
    },

    getSortedNames() {
      return [...sortedVarNames]
    },
  }
}

export type { VariableOption }
