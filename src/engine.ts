import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { parseRefs } from './parser'
import type {
  DashboardConfig,
  DashboardInput,
  DataRequestConfig,
  VariableConfig,
  VariableState,
  PanelState,
  PanelDependencyInfo,
  PanelReadiness,
  QueryResult,
  EngineEvent,
  AuthContext,
  DashboardStateSnapshot,
  PanelRuntimeInstance,
  PanelExpander,
} from './types'
import { DashboardConfigSchema } from './types'
import { createMemoryDashboardStateStore } from './state'
import type {
  DatasourcePluginDef,
  PanelPluginDef,
  CoreEngineAPI,
  CreateDashboardEngineOptions,
} from './define'
import { createVariableEngine, defaultVariableValue, flattenVariables } from './variables'
import { createAuthorization } from './authorization'
import { buildBasePanelInstances, buildPanelExpanders } from './panel-expansion'

// ─── Internal Store Shape ───────────────────────────────────────────────────────

interface EngineStore {
  config: DashboardConfig | null
  variables: Record<string, VariableState>
  panels: Record<string, PanelState>
  panelInstances: PanelRuntimeInstance[]
  timeRange: { from: string; to: string } | undefined
  refresh: string | undefined
  authContext: AuthContext
}

// ─── Query Cache ────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: QueryResult
  ts: number
}

// ─── Engine Implementation ──────────────────────────────────────────────────────

export function createDashboardEngine(options: CreateDashboardEngineOptions): CoreEngineAPI {
  const {
    panels: panelDefs,
    datasourcePlugins: dsDefs,
    variableTypes: vtDefs,
    builtinVariables = [],
    panelExpanders: customPanelExpanders = [],
    stateStore = createMemoryDashboardStateStore(),
    authContext = {},
    authorize: customAuthorize,
  } = options

  const dsMap = new Map<string, DatasourcePluginDef>(dsDefs.map((d) => [d.uid, d]))
  const panelMap = new Map<string, PanelPluginDef>(panelDefs.map((p) => [p.id, p]))

  const cache = new Map<string, CacheEntry>()
  const panelAbortControllers = new Map<string, AbortController>()
  const panelExpanders: PanelExpander[] = buildPanelExpanders(customPanelExpanders)

  const listeners = new Set<(e: EngineEvent) => void>()
  const emit = (e: EngineEvent) => listeners.forEach((l) => l(e))

  const store = createStore<EngineStore>(() => ({
    config: null,
    variables: {},
    panels: {},
    panelInstances: [],
    timeRange: undefined,
    refresh: undefined,
    authContext,
  }))

  let lastDashboardSnapshot: DashboardStateSnapshot = stateStore.getSnapshot()
  let suppressDashboardSnapshotEvents = false

  // ─── Authorization ────────────────────────────────────────────────────────────

  const auth = createAuthorization({
    getAuthContext: () => store.getState().authContext,
    ...(customAuthorize && { authorize: customAuthorize }),
    onDenied(action, resourceId, reason) {
      emit({ type: 'authorization-denied', action, resourceId, reason })
    },
  })

  // ─── Variable Engine ──────────────────────────────────────────────────────────

  const varEngine = createVariableEngine({
    variableTypes: vtDefs,
    datasourcePlugins: dsDefs,
    builtinVariables,
    stateStore,
    getAuthContext: () => store.getState().authContext,
    getDashboardConfig: () => store.getState().config,
    authorizeVariableQuery: ensureVariableDataRequestAuthorized,
  })

  varEngine.subscribe(() => {
    store.setState({ variables: varEngine.getState() })
  })

  // ─── Cache helpers ────────────────────────────────────────────────────────────

  function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      return `{${entries.join(',')}}`
    }
    return JSON.stringify(value)
  }

  function cacheKey(
    dsUid: string,
    dataRequestJson: string,
    variables: Record<string, string | string[]>,
    tr?: { from: string; to: string },
  ): string {
    const authKey = store.getState().authContext.subject?.id ?? 'anonymous'
    return `${dsUid}::${authKey}::${dataRequestJson}::${stableJson(variables)}::${tr?.from ?? ''}::${tr?.to ?? ''}`
  }

  function invalidatePanelCache(panelIds: string[]) {
    for (const pid of panelIds) {
      const pcfg = findPanelInstance(pid)?.config ?? store.getState().config?.panels.find((p) => p.id === pid)
      if (!pcfg) continue
      for (const request of pcfg.dataRequests) {
        for (const key of [...cache.keys()]) {
          if (key.startsWith(`${request.uid}::`)) cache.delete(key)
        }
      }
    }
  }

  // ─── Authorization helpers ────────────────────────────────────────────────────

  async function ensurePanelDataRequestAuthorized(
    cfg: DashboardConfig,
    pcfg: import('./types').PanelConfig,
    dataRequest: DataRequestConfig,
    datasourceUid: string,
  ): Promise<void> {
    const permissions = [...cfg.permissions, ...pcfg.permissions, ...dataRequest.permissions]
    await auth.ensureAuthorized({ action: 'panel:query', dashboard: cfg, panel: pcfg, dataRequest, datasourceUid, permissions })
    await auth.ensureAuthorized({ action: 'datasource:query', dashboard: cfg, panel: pcfg, dataRequest, datasourceUid, permissions })
  }

  async function ensureVariableDataRequestAuthorized(
    cfg: DashboardConfig,
    vcfg: VariableConfig,
    dataRequest: DataRequestConfig,
  ): Promise<void> {
    const permissions = [...cfg.permissions, ...vcfg.permissions, ...dataRequest.permissions]
    await auth.ensureAuthorized({ action: 'variable:query', dashboard: cfg, variable: vcfg, dataRequest, datasourceUid: dataRequest.uid, permissions })
    await auth.ensureAuthorized({ action: 'datasource:query', dashboard: cfg, variable: vcfg, dataRequest, datasourceUid: dataRequest.uid, permissions })
  }

  // ─── Datasource lookup ────────────────────────────────────────────────────────

  function getDatasourceDef(request: DataRequestConfig): DatasourcePluginDef {
    const dsDef = dsMap.get(request.uid)
    if (!dsDef) throw new Error(`datasource "${request.uid}" not registered in engine`)
    if (dsDef.type !== request.type) {
      throw new Error(`datasource "${request.uid}" type mismatch: expected "${request.type}", got "${dsDef.type}"`)
    }
    return dsDef
  }

  // ─── Panel instance helpers ───────────────────────────────────────────────────

  function buildCtxVariables(): Record<string, string | string[]> {
    return varEngine.getVariables()
  }

  function buildPanelInstances(): PanelRuntimeInstance[] {
    const cfg = store.getState().config
    if (!cfg) return []
    return panelExpanders.reduce(
      (instances, expander) => expander.expand(instances, { dashboard: cfg, variables: buildCtxVariables() }),
      buildBasePanelInstances(cfg),
    )
  }

  function defaultPanelState(id: string): PanelState {
    return { id, data: null, rawData: null, loading: false, error: null, width: 0, height: 0, active: true }
  }

  function syncPanelInstances(): void {
    const nextInstances = buildPanelInstances()
    const nextIds = new Set(nextInstances.map((p) => p.id))

    store.setState((s) => {
      const panels = { ...s.panels }
      for (const id of Object.keys(panels)) {
        if (!nextIds.has(id)) {
          panelAbortControllers.get(id)?.abort()
          panelAbortControllers.delete(id)
          delete panels[id]
        }
      }
      for (const instance of nextInstances) {
        panels[instance.id] ??= defaultPanelState(instance.id)
      }
      return { panelInstances: nextInstances, panels }
    })
  }

  function findPanelInstance(instanceId: string): PanelRuntimeInstance | undefined {
    return store.getState().panelInstances.find((p) => p.id === instanceId)
  }

  function panelRefsVar(instance: PanelRuntimeInstance, varName: string): boolean {
    const panel = instance.config
    const inTitle = panel.title ? parseRefs(panel.title).refs.includes(varName) : false
    const inDataRequests = panel.dataRequests.some((r) => JSON.stringify(r).includes('$' + varName))
    return inTitle || inDataRequests || panel.repeat === varName
  }

  function getPanelDependenciesForInstance(instance: PanelRuntimeInstance): PanelDependencyInfo {
    const direct = new Set<string>()
    const panel = instance.config

    if (panel.title) {
      for (const ref of parseRefs(panel.title).refs) direct.add(ref)
    }

    for (const request of panel.dataRequests) {
      if (request.query !== undefined) {
        for (const ref of parseRefs(JSON.stringify(request.query)).refs) direct.add(ref)
      }
      for (const ref of parseRefs(JSON.stringify(request.options)).refs) direct.add(ref)
    }

    if (panel.repeat) direct.add(panel.repeat)

    const directVariables = [...direct]
    return { directVariables, requiredVariables: directVariables }
  }

  function panelsReferencingVar(varName: string): string[] {
    return store.getState().panelInstances
      .filter((instance) => panelRefsVar(instance, varName))
      .map((instance) => instance.id)
  }

  // ─── State sync helpers ───────────────────────────────────────────────────────

  function valuesEqual(a: string | string[] | undefined, b: string | string[] | undefined): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    }
    return a === b
  }

  function mirrorDashboardSnapshot(snapshot: DashboardStateSnapshot) {
    store.setState((s) => {
      const cfg = s.config
      const variables = { ...s.variables }
      for (const [name, state] of Object.entries(variables)) {
        const vcfg = cfg?.variables.find((v) => v.name === name)
        variables[name] = {
          ...state,
          value: snapshot.variables[name] ?? (vcfg ? defaultVariableValue(vcfg) : state.value),
        }
      }
      return { variables, timeRange: snapshot.timeRange, refresh: snapshot.refresh }
    })
  }

  function changedVariableNames(prev: DashboardStateSnapshot, next: DashboardStateSnapshot): string[] {
    const names = new Set([...Object.keys(prev.variables), ...Object.keys(next.variables)])
    return [...names].filter((name) => !valuesEqual(prev.variables[name], next.variables[name]))
  }

  function buildDefaultStatePatch(cfg: DashboardConfig): import('./types').DashboardStatePatch {
    const snapshot = stateStore.getSnapshot()
    const variables: Record<string, string | string[] | undefined> = {}
    for (const v of cfg.variables) {
      if (snapshot.variables[v.name] === undefined) {
        variables[v.name] = defaultVariableValue(v)
      }
    }
    return {
      ...(Object.keys(variables).length > 0 ? { variables } : {}),
      ...(snapshot.timeRange === undefined && cfg.timeRange !== undefined ? { timeRange: cfg.timeRange } : {}),
      ...(snapshot.refresh === undefined ? { refresh: cfg.refresh } : {}),
    }
  }

  // ─── Panel execution helpers ──────────────────────────────────────────────────

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  }

  function isCurrentPanelRequest(panelId: string, controller: AbortController): boolean {
    return panelAbortControllers.get(panelId) === controller && !controller.signal.aborted
  }

  function assertCurrentPanelRequest(panelId: string, controller: AbortController): void {
    if (!isCurrentPanelRequest(panelId, controller)) {
      throw Object.assign(new Error('AbortError'), { name: 'AbortError' })
    }
  }

  function startPanelRequest(panelId: string, supersede: boolean): AbortController | null {
    const existing = panelAbortControllers.get(panelId)
    if (existing) {
      if (!supersede) return null
      existing.abort()
    }
    const controller = new AbortController()
    panelAbortControllers.set(panelId, controller)
    return controller
  }

  function abortPanelRequests(): void {
    for (const ctrl of panelAbortControllers.values()) ctrl.abort()
    panelAbortControllers.clear()
  }

  function buildPanelQueryContext(instance: PanelRuntimeInstance) {
    const tr = stateStore.getSnapshot().timeRange
    const effectiveVariables = { ...buildCtxVariables(), ...(instance.variablesOverride ?? {}) }
    const flatVars = flattenVariables(effectiveVariables)
    return { tr, flatVars }
  }

  function readPanelCache(
    activeRequests: DataRequestConfig[],
    flatVars: Record<string, string | string[]>,
    tr: { from: string; to: string } | undefined,
  ): QueryResult[] | null {
    const results: QueryResult[] = []
    for (const request of activeRequests) {
      const cached = cache.get(cacheKey(request.uid, JSON.stringify(request), flatVars, tr))
      if (!cached) return null
      results.push({ ...cached.data, requestId: request.id })
    }
    return results
  }

  function applyPanelData(panelId: string, data: unknown, rawData: QueryResult[]): void {
    store.setState((s) => ({
      panels: { ...s.panels, [panelId]: { ...s.panels[panelId]!, data, rawData, loading: false, error: null } },
    }))
    emit({ type: 'panel-data', panelId, data })
  }

  function applyPanelError(panelId: string, error: string): void {
    store.setState((s) => ({
      panels: { ...s.panels, [panelId]: { ...s.panels[panelId]!, loading: false, error } },
    }))
    emit({ type: 'panel-error', panelId, error })
  }

  async function fetchPanelRequests(
    panelId: string,
    cfg: DashboardConfig,
    instance: PanelRuntimeInstance,
    activeRequests: DataRequestConfig[],
    flatVars: Record<string, string | string[]>,
    tr: { from: string; to: string } | undefined,
    controller: AbortController,
  ): Promise<QueryResult[]> {
    const { signal } = controller
    return Promise.all(
      activeRequests.map(async (request) => {
        const dsDef = getDatasourceDef(request)
        const key = cacheKey(request.uid, JSON.stringify(request), flatVars, tr)
        const result = await dsDef.query({
          dataRequest: request,
          dashboardId: cfg.id,
          panelId,
          requestId: request.id,
          ...(request.query !== undefined ? { query: request.query } : {}),
          requestOptions: request.options,
          variables: flatVars,
          datasourceOptions: dsDef.options ?? ({} as never),
          authContext: store.getState().authContext,
          ...(tr !== undefined ? { timeRange: tr } : {}),
          signal,
          builtins: varEngine.getBuiltins(),
          panel: instance.config,
          panelOptions: instance.config.options,
          panelInstance: instance,
        })
        assertCurrentPanelRequest(panelId, controller)
        cache.set(key, { data: result, ts: Date.now() })
        return { ...result, requestId: request.id }
      }),
    )
  }

  // ─── Panel Query Execution ────────────────────────────────────────────────────

  async function executePanel(panelId: string, opts: { supersede?: boolean } = {}): Promise<void> {
    const cfg = store.getState().config
    if (!cfg) return
    const instance = findPanelInstance(panelId)
    if (!instance) return
    const pcfg = instance.config

    if (!store.getState().panels[panelId]?.active) return

    const activeRequests = pcfg.dataRequests.filter((r) => !r.hide)
    if (activeRequests.length === 0) return

    const controller = startPanelRequest(panelId, opts.supersede !== false)
    if (!controller) return

    try {
      const { flatVars, tr } = buildPanelQueryContext(instance)

      for (const request of activeRequests) {
        getDatasourceDef(request)
        await ensurePanelDataRequestAuthorized(cfg, pcfg, request, request.uid)
      }
      assertCurrentPanelRequest(panelId, controller)

      const cached = readPanelCache(activeRequests, flatVars, tr)
      if (cached) {
        assertCurrentPanelRequest(panelId, controller)
        const panelDef = panelMap.get(pcfg.type)
        applyPanelData(panelId, panelDef?.transform ? panelDef.transform(cached) : cached, cached)
        return
      }

      store.setState((s) => ({
        panels: { ...s.panels, [panelId]: { ...s.panels[panelId]!, loading: true, error: null } },
      }))
      emit({ type: 'panel-loading', panelId })

      const results = await fetchPanelRequests(panelId, cfg, instance, activeRequests, flatVars, tr, controller)

      assertCurrentPanelRequest(panelId, controller)
      const panelDef = panelMap.get(pcfg.type)
      applyPanelData(panelId, panelDef?.transform ? panelDef.transform(results) : results, results)
    } catch (e) {
      if (!isCurrentPanelRequest(panelId, controller) || isAbortError(e)) return
      applyPanelError(panelId, e instanceof Error ? e.message : String(e))
    } finally {
      if (panelAbortControllers.get(panelId) === controller) panelAbortControllers.delete(panelId)
    }
  }

  async function refreshAllPanels(opts: { supersede?: boolean } = {}): Promise<void> {
    await Promise.all(store.getState().panelInstances.map((p) => executePanel(p.id, opts)))
  }

  // ─── Variable refresh ─────────────────────────────────────────────────────────

  async function refreshVariables({
    emitChanges,
    supersedePanels = true,
  }: {
    emitChanges: boolean
    supersedePanels?: boolean
  }): Promise<void> {
    suppressDashboardSnapshotEvents = true
    let changed: string[]
    try {
      changed = await varEngine.refresh()
      syncPanelInstances()
    } finally {
      suppressDashboardSnapshotEvents = false
    }

    if (emitChanges) {
      const snapshot = stateStore.getSnapshot()
      for (const name of changed) {
        const value = snapshot.variables[name]
        if (value !== undefined) emit({ type: 'variable-changed', name, value })
      }
    }

    await refreshAllPanels({ supersede: supersedePanels })
  }

  // ─── Snapshot change handler ──────────────────────────────────────────────────

  async function handleDashboardSnapshotChange(snapshot: DashboardStateSnapshot): Promise<void> {
    const cfg = store.getState().config
    const prev = lastDashboardSnapshot
    lastDashboardSnapshot = snapshot
    mirrorDashboardSnapshot(snapshot)
    if (!cfg) return

    const changedVars = changedVariableNames(prev, snapshot)
    const timeChanged =
      prev.timeRange?.from !== snapshot.timeRange?.from ||
      prev.timeRange?.to !== snapshot.timeRange?.to
    const refreshChanged = prev.refresh !== snapshot.refresh

    for (const name of changedVars) {
      const value = snapshot.variables[name]
      if (value !== undefined) emit({ type: 'variable-changed', name, value })
    }
    if (refreshChanged && snapshot.refresh !== undefined) {
      emit({ type: 'refresh-changed', refresh: snapshot.refresh })
    }
    if (timeChanged && snapshot.timeRange) {
      emit({ type: 'time-range-changed', range: snapshot.timeRange })
      cache.clear()
    }

    if (changedVars.length > 0) {
      suppressDashboardSnapshotEvents = true
      let downstreamChanged: string[]
      try {
        downstreamChanged = await varEngine.refreshDownstream(changedVars)
      } finally {
        suppressDashboardSnapshotEvents = false
      }

      syncPanelInstances()
      const affectedVars = [...new Set([...changedVars, ...downstreamChanged])]
      for (const name of downstreamChanged) {
        const value = stateStore.getSnapshot().variables[name]
        if (value !== undefined) emit({ type: 'variable-changed', name, value })
      }
      const affected = [...new Set(affectedVars.flatMap((name) => panelsReferencingVar(name)))]
      invalidatePanelCache(affected)
      await Promise.all(affected.map((panelId) => executePanel(panelId)))
    }

    if (timeChanged) {
      await api.refreshAll()
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  const api: CoreEngineAPI = {
    load(config: DashboardInput) {
      const parsed = DashboardConfigSchema.parse(config)
      const defaultPatch = buildDefaultStatePatch(parsed)
      abortPanelRequests()
      suppressDashboardSnapshotEvents = true
      if (Object.keys(defaultPatch).length > 0) stateStore.setPatch(defaultPatch)
      const snapshot = stateStore.getSnapshot()
      lastDashboardSnapshot = snapshot

      const initPanels: Record<string, PanelState> = {}
      for (const p of parsed.panels) initPanels[p.id] = defaultPanelState(p.id)

      store.setState({
        config: parsed,
        variables: {},
        panels: initPanels,
        panelInstances: [],
        timeRange: snapshot.timeRange,
        refresh: snapshot.refresh,
        authContext: store.getState().authContext,
      })

      varEngine.load(parsed.variables)
      store.setState({ variables: varEngine.getState() })
      syncPanelInstances()
      cache.clear()

      void (async () => {
        try {
          await refreshVariables({ emitChanges: false, supersedePanels: false })
        } finally {
          suppressDashboardSnapshotEvents = false
        }
      })()
    },

    getConfig() { return store.getState().config },
    getVariable(name) { return store.getState().variables[name] },

    setVariable(name, value) {
      if (!store.getState().variables[name]) return
      stateStore.setPatch({ variables: { [name]: value } })
    },

    refreshVariables() { return refreshVariables({ emitChanges: true }) },
    getVariableReadiness(names) { return varEngine.getVariableReadiness(names) },
    getPanel(panelId) { return store.getState().panels[panelId] },
    getPanelInstances() { return [...store.getState().panelInstances] },
    getPanelInstance(panelId) { return findPanelInstance(panelId) },
    getPanelDependencies(panelId) {
      const instance = findPanelInstance(panelId)
      return instance ? getPanelDependenciesForInstance(instance) : null
    },
    getPanelReadiness(panelId): PanelReadiness | null {
      const instance = findPanelInstance(panelId)
      const dependencies = instance ? getPanelDependenciesForInstance(instance) : null
      if (!dependencies) return null
      const readiness = varEngine.getVariableReadiness(dependencies.requiredVariables)
      return {
        ready: readiness.ready,
        waitingVariables: readiness.waiting,
        variableErrors: readiness.errors,
      }
    },

    async refreshPanel(panelId) {
      invalidatePanelCache([panelId])
      await executePanel(panelId)
    },

    async refreshAll() { await refreshAllPanels() },
    setTimeRange(range) { stateStore.setPatch({ timeRange: range }) },
    getTimeRange() { return stateStore.getSnapshot().timeRange },
    setRefresh(refresh) { stateStore.setPatch({ refresh }) },
    getRefresh() { return stateStore.getSnapshot().refresh },

    setAuthContext(context) {
      store.setState({ authContext: context })
      cache.clear()
      void api.refreshVariables()
    },

    getAuthContext() { return store.getState().authContext },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  ;(api as CoreEngineAPI & { _store: StoreApi<EngineStore> })._store = store
  ;(api as CoreEngineAPI & { _unsubscribeStateStore: () => void })._unsubscribeStateStore =
    stateStore.subscribe((snapshot) => {
      if (suppressDashboardSnapshotEvents) {
        lastDashboardSnapshot = snapshot
        mirrorDashboardSnapshot(snapshot)
        return
      }
      void handleDashboardSnapshotChange(snapshot)
    })

  return api
}
