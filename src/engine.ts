import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { buildVariableDAG, CircularDependencyError } from './dag'
import { parseRefs } from './parser'
import { buildBuiltinMap } from './builtins'
import type { BuiltinVariable, BuiltinContext } from './builtins'
import type {
  DashboardConfig,
  DashboardInput,
  VariableState,
  PanelState,
  QueryResult,
  EngineEvent,
} from './types'
import { DashboardConfigSchema } from './types'
import type {
  DatasourcePluginDef,
  PanelPluginDef,
  VariableTypePluginDef,
  CoreEngineAPI,
  CreateDashboardEngineOptions,
} from './define'

// ─── Internal Store Shape ───────────────────────────────────────────────────────

interface EngineStore {
  config: DashboardConfig | null
  variables: Record<string, VariableState>
  panels: Record<string, PanelState>
  timeRange: { from: string; to: string } | undefined
}

// ─── Query Cache ────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: QueryResult
  ts: number
}

// ─── Engine Implementation ──────────────────────────────────────────────────────

export function createDashboardEngine(options: CreateDashboardEngineOptions): CoreEngineAPI {
  const { panels: panelDefs, datasources: dsDefs, variableTypes: vtDefs, builtinVariables = [] } =
    options

  // Plugin maps — keyed by uid for direct lookup (target.datasource.uid → plugin)
  const dsMap = new Map<string, DatasourcePluginDef>(dsDefs.map((d) => [d.uid, d]))
  const panelMap = new Map<string, PanelPluginDef>(panelDefs.map((p) => [p.id, p]))
  const vtMap = new Map<string, VariableTypePluginDef>(vtDefs.map((v) => [v.id, v]))

  // Query cache: `dsId::interpolatedQuery::from::to` → QueryResult
  const cache = new Map<string, CacheEntry>()

  // Event listeners
  const listeners = new Set<(e: EngineEvent) => void>()
  const emit = (e: EngineEvent) => listeners.forEach((l) => l(e))

  // Zustand vanilla store
  const store = createStore<EngineStore>(() => ({
    config: null,
    variables: {},
    panels: {},
    timeRange: undefined,
  }))

  // Topologically sorted variable execution order
  let sortedVarNames: string[] = []

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getBuiltinCtx(): BuiltinContext {
    const tr = store.getState().timeRange ?? { from: new Date().toISOString(), to: new Date().toISOString() }
    const cfg = store.getState().config
    return {
      timeRange: tr,
      dashboard: { id: cfg?.id ?? '', title: cfg?.title ?? '' },
    }
  }

  function buildCtxBuiltins(): Record<string, string> {
    return buildBuiltinMap(getBuiltinCtx(), builtinVariables as BuiltinVariable[])
  }

  function buildCtxVariables(): Record<string, string | string[]> {
    const vars = store.getState().variables
    const result: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(vars)) {
      result[k] = v.value
    }
    return result
  }

  function cacheKey(dsUid: string, targetJson: string, tr?: { from: string; to: string }): string {
    return `${dsUid}::${targetJson}::${tr?.from ?? ''}::${tr?.to ?? ''}`
  }

  // Extract datasource uid from target — the only target field the library knows
  // target.datasource is a known field of TargetSchema so typed access is safe
  function resolveTargetDsUid(target: import('./types').Target, panelDsUid?: string): string | undefined {
    return target.datasource?.uid ?? panelDsUid
  }

  function invalidatePanelCache(panelIds: string[]) {
    const cfg = store.getState().config
    if (!cfg) return
    for (const pid of panelIds) {
      const pcfg = cfg.panels.find((p) => p.id === pid)
      if (!pcfg) continue
      const panelDsUid = pcfg.datasource?.uid
      for (const target of pcfg.targets) {
        const uid = resolveTargetDsUid(target, panelDsUid)
        if (!uid) continue
        for (const key of [...cache.keys()]) {
          if (key.startsWith(`${uid}::`)) cache.delete(key)
        }
      }
    }
  }

  // Panel IDs that reference a specific variable
  // Serialize the full target as JSON and check for $varName presence
  // (also detects variable references in plugin-specific fields automatically)
  function panelsReferencingVar(varName: string): string[] {
    const cfg = store.getState().config
    if (!cfg) return []
    return cfg.panels
      .filter((p) => {
        const inTitle = p.title ? parseRefs(p.title).refs.includes(varName) : false
        const inTargets = p.targets.some((t) => JSON.stringify(t).includes('$' + varName))
        return inTitle || inTargets
      })
      .map((p) => p.id)
  }

  // ─── Variable Resolution ─────────────────────────────────────────────────────

  async function resolveOneVariable(name: string): Promise<void> {
    const cfg = store.getState().config
    if (!cfg) return
    const vcfg = cfg.variables.find((v) => v.name === name)
    if (!vcfg) return

    const vtDef = vtMap.get(vcfg.type)
    if (!vtDef) {
      console.warn(`[dashboardkit] Unknown variable type: ${vcfg.type}`)
      return
    }

    // Set loading state
    store.setState((s) => ({
      variables: {
        ...s.variables,
        [name]: { ...s.variables[name]!, loading: true, error: null },
      },
    }))

    try {
      const dsMap2 = new Map<string, DatasourcePluginDef>()
      for (const [k, v] of dsMap) dsMap2.set(k, v)

      const options = resolveOptions(vcfg.options, vtDef)
      const resolveCtx = {
        datasources: Object.fromEntries(dsMap2),
        builtins: buildCtxBuiltins(),
        variables: buildCtxVariables(),
      }

      const newOptions = await vtDef.resolve(vcfg, options as never, resolveCtx)

      // Reset to first option if current value is no longer in the option list
      const cur = store.getState().variables[name]?.value
      const validValues = newOptions.map((o) => o.value)
      const curArr = Array.isArray(cur) ? cur : cur ? [cur] : []
      const stillValid = curArr.every((v) => validValues.includes(v))

      let newValue: string | string[]
      if (stillValid && curArr.length > 0) {
        newValue = vcfg.multi ? curArr : curArr[0]!
      } else if (vcfg.defaultValue !== null && vcfg.defaultValue !== undefined) {
        newValue = vcfg.defaultValue
      } else {
        newValue = vcfg.multi ? (newOptions[0] ? [newOptions[0].value] : []) : (newOptions[0]?.value ?? '')
      }

      store.setState((s) => ({
        variables: {
          ...s.variables,
          [name]: { ...s.variables[name]!, options: newOptions, value: newValue, loading: false },
        },
      }))

      emit({ type: 'variable-changed', name, value: newValue })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      store.setState((s) => ({
        variables: {
          ...s.variables,
          [name]: { ...s.variables[name]!, loading: false, error },
        },
      }))
    }
  }

  function resolveOptions(raw: Record<string, unknown>, _def: VariableTypePluginDef): Record<string, unknown> {
    return raw
  }

  // ─── Panel Query Execution ──────────────────────────────────────────────────
  // Run each targets[] in parallel → pass results[] to panelDef.transform

  async function executePanel(panelId: string): Promise<void> {
    const cfg = store.getState().config
    if (!cfg) return
    const pcfg = cfg.panels.find((p) => p.id === panelId)
    if (!pcfg) return

    const panel = store.getState().panels[panelId]
    if (!panel?.active) return // skip panels outside the viewport

    // Only run targets where hide is false (library-owned field)
    const activeTargets = pcfg.targets.filter((t) => !t.hide)
    if (activeTargets.length === 0) return

    const tr = store.getState().timeRange
    const flatVars = Object.fromEntries(
      Object.entries(buildCtxVariables()).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
    )

    const panelDsUid = pcfg.datasource?.uid

    // Check cache (return immediately if all targets hit cache)
    // Cache key = dsUid + raw target JSON (interpolation is the plugin's responsibility)
    const cachedResults: QueryResult[] = []
    let allCached = true
    for (const target of activeTargets) {
      const uid = resolveTargetDsUid(target, panelDsUid)
      if (!uid) { allCached = false; break }
      const key = cacheKey(uid, JSON.stringify(target), tr)
      const cached = cache.get(key)
      if (cached) {
        cachedResults.push({ ...cached.data, refId: target.refId })
      } else {
        allCached = false
        break
      }
    }

    if (allCached) {
      const panelDef = panelMap.get(pcfg.type)
      const data = panelDef?.transform
        ? panelDef.transform(cachedResults.length === 1 ? cachedResults[0]! : (cachedResults as unknown as QueryResult))
        : cachedResults
      store.setState((s) => ({
        panels: {
          ...s.panels,
          [panelId]: { ...s.panels[panelId]!, data, rawData: cachedResults[0] ?? null, loading: false, error: null },
        },
      }))
      emit({ type: 'panel-data', panelId, data })
      return
    }

    // Set loading state
    store.setState((s) => ({
      panels: { ...s.panels, [panelId]: { ...s.panels[panelId]!, loading: true, error: null } },
    }))
    emit({ type: 'panel-loading', panelId })

    try {
      // Run targets in parallel
      const results = await Promise.all(
        activeTargets.map(async (target) => {
          // The library only reads datasource uid. All other fields belong to the plugin.
          const uid = resolveTargetDsUid(target, panelDsUid)
          if (!uid) throw new Error(`panel "${panelId}" target "${target.refId}" has no datasource`)

          // Direct uid lookup — no datasources[] registry needed in dashboard JSON
          const dsDef = dsMap.get(uid)
          if (!dsDef) throw new Error(`datasource "${uid}" not registered in engine`)

          const key = cacheKey(uid, JSON.stringify(target), tr)

          // Delegate full target to the plugin. Interpolation is also the plugin's responsibility.
          const result = await dsDef.query({
            target: target as Record<string, unknown>,
            refId: target.refId,
            variables: flatVars,
            datasourceOptions: dsDef.options ?? ({} as never),
            ...(tr !== undefined ? { timeRange: tr } : {}),
          })

          cache.set(key, { data: result, ts: Date.now() })
          return { ...result, refId: target.refId }
        }),
      )

      const panelDef = panelMap.get(pcfg.type)
      // Pass QueryResult for single target, QueryResult[] for multiple
      const raw = results.length === 1 ? results[0]! : (results as unknown as QueryResult)
      const data = panelDef?.transform ? panelDef.transform(raw) : results

      store.setState((s) => ({
        panels: {
          ...s.panels,
          [panelId]: { ...s.panels[panelId]!, data, rawData: results[0] ?? null, loading: false, error: null },
        },
      }))
      emit({ type: 'panel-data', panelId, data })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      store.setState((s) => ({
        panels: { ...s.panels, [panelId]: { ...s.panels[panelId]!, loading: false, error } },
      }))
      emit({ type: 'panel-error', panelId, error })
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const api: CoreEngineAPI = {
    load(config: DashboardInput) {
      const parsed = DashboardConfigSchema.parse(config)
      // DAG topological sort — throws immediately on failure
      try {
        sortedVarNames = buildVariableDAG(
          parsed.variables.map((v) => ({
            name: v.name,
            ...(v.query !== undefined ? { query: v.query } : {}),
          })),
        )
      } catch (e) {
        if (e instanceof CircularDependencyError) throw e
        throw e
      }

      // Initial variable state
      const initVars: Record<string, VariableState> = {}
      for (const v of parsed.variables) {
        const defaultVal = v.defaultValue ?? (v.multi ? [] : '')
        initVars[v.name] = {
          name: v.name,
          type: v.type,
          value: defaultVal,
          options: [],
          loading: false,
          error: null,
        }
      }

      // Initial panel state
      const initPanels: Record<string, PanelState> = {}
      for (const p of parsed.panels) {
        initPanels[p.id] = {
          id: p.id,
          data: null,
          rawData: null,
          loading: false,
          error: null,
          width: 0,
          height: 0,
          active: true, // default true until IntersectionObserver is attached
        }
      }

      store.setState({
        config: parsed,
        variables: initVars,
        panels: initPanels,
        timeRange: parsed.timeRange ?? undefined,
      })

      cache.clear()

      // Kick off initial variable refresh
      void api.refreshVariables()
    },

    getConfig() {
      return store.getState().config
    },

    getVariable(name) {
      return store.getState().variables[name]
    },

    setVariable(name, value) {
      const prev = store.getState().variables[name]
      if (!prev) return

      store.setState((s) => ({
        variables: { ...s.variables, [name]: { ...prev, value } },
      }))
      emit({ type: 'variable-changed', name, value })

      // Re-resolve downstream variables that depend on this one (in DAG order)
      const idx = sortedVarNames.indexOf(name)
      const downstream = sortedVarNames.slice(idx + 1)
      const cfg = store.getState().config
      if (cfg) {
        const downstreamVarNames = downstream.filter((n) => {
          const vcfg = cfg.variables.find((v) => v.name === n)
          if (!vcfg?.query) return false
          return parseRefs(vcfg.query).refs.includes(name)
        })
        void (async () => {
          for (const n of downstreamVarNames) await resolveOneVariable(n)
          // Invalidate cache and re-run panels that reference this variable
          const affected = panelsReferencingVar(name)
          invalidatePanelCache(affected)
          await Promise.all(affected.map(executePanel))
        })()
      }
    },

    async refreshVariables() {
      for (const name of sortedVarNames) {
        await resolveOneVariable(name)
      }
      // Run all panels after variable refresh
      await api.refreshAll()
    },

    getPanel(panelId) {
      return store.getState().panels[panelId]
    },

    async refreshPanel(panelId) {
      invalidatePanelCache([panelId])
      await executePanel(panelId)
    },

    async refreshAll() {
      const cfg = store.getState().config
      if (!cfg) return
      await Promise.all(cfg.panels.map((p) => executePanel(p.id)))
    },

    setTimeRange(range) {
      store.setState({ timeRange: range })
      emit({ type: 'time-range-changed', range })
      // Invalidate full cache
      cache.clear()
      void api.refreshAll()
    },

    getTimeRange() {
      return store.getState().timeRange
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  // Expose Zustand store for external subscription (hooks)
  ;(api as CoreEngineAPI & { _store: StoreApi<EngineStore> })._store = store

  return api
}
