import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { parseRefs } from '../query'
import type {
  DashboardConfig,
  DashboardInput,
  DashboardLoadOptions,
  DataRequestConfig,
  DataRequestInput,
  VariableConfig,
  VariableState,
  PanelConfig,
  PanelInput,
  PanelState,
  PanelDependencyInfo,
  PanelReadiness,
  QueryResult,
  EngineEvent,
  AuthContext,
  DashboardStateSnapshot,
  PanelRuntimeInstance,
  PanelExpander,
} from '../schema'
import { DashboardConfigSchema, DataRequestSchema, PanelConfigSchema } from '../schema'
import { validateOptionSchema } from '../schema'
import { createMemoryDashboardStateStore } from './state'
import type {
  PanelPluginDef,
  CoreEngineAPI,
  CreateDashboardEngineOptions,
} from '../schema'
import { createVariableEngine, defaultVariableValue } from '../variables'
import { createAuthorization } from './authorization'
import { buildBasePanelInstances, buildPanelExpanders } from '../panels'
import { createDatasourceRegistry } from '../datasources'

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

// ─── Panel Cache ────────────────────────────────────────────────────────────────

interface PanelCacheEntry {
  panelId: string
  requestId: string
  datasourceUid: string
  value: QueryResult
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

  const datasourceRegistry = createDatasourceRegistry(dsDefs)
  const panelMap = new Map<string, PanelPluginDef>(panelDefs.map((p) => [p.id, p]))

  // P0-3: metadata-based cache + secondary index by panelId
  const cache = new Map<string, PanelCacheEntry>()
  const cacheKeysByPanelId = new Map<string, Set<string>>()

  const panelAbortControllers = new Map<string, AbortController>()
  const panelExpanders: PanelExpander[] = buildPanelExpanders(customPanelExpanders)

  // Phase E: cross-filter — panel-scoped variable overrides, engine memory only
  const panelSelections = new Map<string, Record<string, string | string[]>>()

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
    panelId: string,
    requestId: string,
    dsUid: string,
    dataRequestJson: string,
    variables: Record<string, string | string[]>,
    tr?: { from: string; to: string },
  ): string {
    const authKey = store.getState().authContext.subject?.id ?? 'anonymous'
    return `${panelId}::${requestId}::${dsUid}::${authKey}::${dataRequestJson}::${stableJson(variables)}::${tr?.from ?? ''}::${tr?.to ?? ''}`
  }

  function setCache(key: string, entry: PanelCacheEntry): void {
    cache.set(key, entry)
    let keys = cacheKeysByPanelId.get(entry.panelId)
    if (!keys) {
      keys = new Set()
      cacheKeysByPanelId.set(entry.panelId, keys)
    }
    keys.add(key)
  }

  function clearCache(): void {
    cache.clear()
    cacheKeysByPanelId.clear()
  }

  function invalidatePanelCache(panelIds: string[]): void {
    for (const pid of panelIds) {
      const keys = cacheKeysByPanelId.get(pid)
      if (!keys) continue
      for (const key of keys) cache.delete(key)
      cacheKeysByPanelId.delete(pid)
    }
  }

  // ─── Authorization helpers ────────────────────────────────────────────────────

  async function ensurePanelDataRequestAuthorized(
    cfg: DashboardConfig,
    pcfg: PanelConfig,
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

  async function ensurePreviewDataRequestAuthorized(
    cfg: DashboardConfig,
    dataRequest: DataRequestConfig,
    pcfg?: PanelConfig,
  ): Promise<void> {
    const permissions = pcfg
      ? [...cfg.permissions, ...pcfg.permissions, ...dataRequest.permissions]
      : [...cfg.permissions, ...dataRequest.permissions]
    await auth.ensureAuthorized({
      action: 'datasource:query',
      dashboard: cfg,
      ...(pcfg ? { panel: pcfg } : {}),
      dataRequest,
      datasourceUid: dataRequest.uid,
      permissions,
    })
  }

  // ─── Panel instance helpers ───────────────────────────────────────────────────

  function buildCtxVariables(): Record<string, string | string[]> {
    return varEngine.getVariables()
  }

  function buildCrossFilterVariables(): Record<string, string | string[]> {
    const merged: Record<string, string | string[]> = {}
    for (const filters of panelSelections.values()) Object.assign(merged, filters)
    return merged
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

  // P0-1: shared helper for exact variable reference detection
  function collectPanelRefs(panel: PanelConfig): Set<string> {
    const refs = new Set<string>()
    if (panel.title) {
      for (const ref of parseRefs(panel.title).refs) refs.add(ref)
    }
    if (panel.repeat) refs.add(panel.repeat)
    for (const request of panel.dataRequests) {
      const queryText = request.query !== undefined ? JSON.stringify(request.query) : '{}'
      const optionsText = request.options !== undefined ? JSON.stringify(request.options) : '{}'
      for (const ref of parseRefs(queryText).refs) refs.add(ref)
      for (const ref of parseRefs(optionsText).refs) refs.add(ref)
    }
    const panelOptionsText = panel.options !== undefined ? JSON.stringify(panel.options) : '{}'
    for (const ref of parseRefs(panelOptionsText).refs) refs.add(ref)
    return refs
  }

  function panelRefsVar(instance: PanelRuntimeInstance, varName: string): boolean {
    return collectPanelRefs(instance.config).has(varName)
  }

  function getPanelDependenciesForInstance(instance: PanelRuntimeInstance): PanelDependencyInfo {
    const directVariables = [...collectPanelRefs(instance.config)]
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

  function buildDefaultStatePatch(cfg: DashboardConfig): import('../schema/types').DashboardStatePatch {
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
      throw abortError()
    }
  }

  function abortError(): Error {
    return Object.assign(new Error('AbortError'), { name: 'AbortError' })
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
    // cross-filter sits between global vars and repeat-instance overrides
    const effectiveVariables = { ...buildCtxVariables(), ...buildCrossFilterVariables(), ...(instance.variablesOverride ?? {}) }
    return { tr, variables: effectiveVariables }
  }

  function readPanelCache(
    panelId: string,
    activeRequests: DataRequestConfig[],
    variables: Record<string, string | string[]>,
    tr: { from: string; to: string } | undefined,
  ): QueryResult[] | null {
    const results: QueryResult[] = []
    for (const request of activeRequests) {
      const key = cacheKey(panelId, request.id, request.uid, JSON.stringify(request), variables, tr)
      const cached = cache.get(key)
      if (!cached) return null
      results.push({ ...cached.value, requestId: request.id })
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
    variables: Record<string, string | string[]>,
    tr: { from: string; to: string } | undefined,
    controller: AbortController,
  ): Promise<QueryResult[]> {
    const { signal } = controller
    return Promise.all(
      activeRequests.map(async (request) => {
        const dsDef = datasourceRegistry.getForRequest(request)
        const key = cacheKey(panelId, request.id, request.uid, JSON.stringify(request), variables, tr)
        const result = await dsDef.query({
          dataRequest: request,
          dashboardId: cfg.id,
          panelId,
          requestId: request.id,
          ...(request.query !== undefined ? { query: request.query } : {}),
          requestOptions: request.options,
          variables,
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
        setCache(key, { panelId, requestId: request.id, datasourceUid: request.uid, value: result })
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
      const { variables, tr } = buildPanelQueryContext(instance)

      for (const request of activeRequests) {
        datasourceRegistry.getForRequest(request)
        await ensurePanelDataRequestAuthorized(cfg, pcfg, request, request.uid)
      }
      assertCurrentPanelRequest(panelId, controller)

      const cached = readPanelCache(panelId, activeRequests, variables, tr)
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

      const results = await fetchPanelRequests(panelId, cfg, instance, activeRequests, variables, tr, controller)

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

  async function refreshVariableNames(names: string[]): Promise<string[]> {
    const requested = new Set(names)
    const changed: string[] = []
    for (const name of varEngine.getSortedNames()) {
      if (!requested.has(name)) continue
      if (await varEngine.refreshOne(name)) changed.push(name)
    }
    return changed
  }

  async function refreshTimeRangeVariables(cfg: DashboardConfig): Promise<string[]> {
    const names = cfg.variables
      .filter((variable) => variable.refreshOnTimeRangeChange)
      .map((variable) => variable.name)
    if (names.length === 0) return []

    suppressDashboardSnapshotEvents = true
    try {
      const directChanged = await refreshVariableNames(names)
      const downstreamChanged = directChanged.length > 0
        ? await varEngine.refreshDownstream(directChanged)
        : []
      syncPanelInstances()
      return [...new Set([...directChanged, ...downstreamChanged])]
    } finally {
      suppressDashboardSnapshotEvents = false
    }
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
      clearCache()
    }

    const timeRangeChangedVars = timeChanged ? await refreshTimeRangeVariables(cfg) : []
    for (const name of timeRangeChangedVars) {
      const value = stateStore.getSnapshot().variables[name]
      if (value !== undefined) emit({ type: 'variable-changed', name, value })
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
    // P2-1: load with optional state policy
    load(config: DashboardInput, loadOptions?: DashboardLoadOptions) {
      const parsed = DashboardConfigSchema.parse(config)
      const { statePolicy = 'preserve', state: explicitState } = loadOptions ?? {}

      abortPanelRequests()
      panelSelections.clear()
      suppressDashboardSnapshotEvents = true

      if (statePolicy === 'replace-dashboard-variables') {
        stateStore.setPatch({
          variables: Object.fromEntries(
            parsed.variables.map((v) => [v.name, defaultVariableValue(v) as string | string[]]),
          ),
        })
      }

      if (explicitState) {
        stateStore.setPatch(explicitState)
      }

      if (statePolicy === 'preserve' && !explicitState) {
        const defaultPatch = buildDefaultStatePatch(parsed)
        if (Object.keys(defaultPatch).length > 0) stateStore.setPatch(defaultPatch)
      } else {
        // always fill in any vars still missing after explicit patches
        const defaultPatch = buildDefaultStatePatch(parsed)
        if (Object.keys(defaultPatch).length > 0) stateStore.setPatch(defaultPatch)
      }

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
      clearCache()

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

    // P1-1: refresh a single variable and cascade downstream
    async refreshVariable(name) {
      if (!store.getState().config || !store.getState().variables[name]) return false

      suppressDashboardSnapshotEvents = true
      let directChanged = false
      let downstreamChanged: string[] = []
      try {
        directChanged = await varEngine.refreshOne(name)
        if (directChanged) {
          downstreamChanged = await varEngine.refreshDownstream([name])
        }
        syncPanelInstances()
      } finally {
        suppressDashboardSnapshotEvents = false
      }

      const anyChanged = directChanged || downstreamChanged.length > 0
      if (anyChanged) {
        const allChanged = directChanged ? [name, ...downstreamChanged] : downstreamChanged
        for (const changedName of allChanged) {
          const value = stateStore.getSnapshot().variables[changedName]
          if (value !== undefined) emit({ type: 'variable-changed', name: changedName, value })
        }
        const affected = [...new Set(allChanged.flatMap((n) => panelsReferencingVar(n)))]
        invalidatePanelCache(affected)
        await Promise.all(affected.map((panelId) => executePanel(panelId)))
      }

      return anyChanged
    },

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

    async toggleRow(panelId) {
      const cfg = store.getState().config
      if (!cfg) return

      const row = cfg.panels.find((p) => p.id === panelId)
      if (!row?.isRow) {
        throw Object.assign(
          new Error(`Panel "${panelId}" is not a row panel or does not exist`),
          { name: 'PanelNotFoundError' },
        )
      }

      const beforeIds = new Set(store.getState().panelInstances.map((instance) => instance.id))
      await api.updatePanel(
        panelId,
        { collapsed: !row.collapsed },
        { refresh: false, invalidateCache: false },
      )

      const nextRow = store.getState().config?.panels.find((p) => p.id === panelId)
      if (!nextRow || nextRow.collapsed) return

      const newlyVisible = store.getState().panelInstances
        .map((instance) => instance.id)
        .filter((id) => !beforeIds.has(id))

      await Promise.all(newlyVisible.map((id) => executePanel(id)))
    },

    // P3-1: update a single panel config without full dashboard reload
    async updatePanel(panelId, patch, options = {}) {
      const { refresh = true, invalidateCache = true } = options
      const cfg = store.getState().config
      if (!cfg) return

      const isOriginPanel = cfg.panels.some((p) => p.id === panelId)
      if (!isOriginPanel) {
        throw Object.assign(
          new Error(`Panel "${panelId}" is not an origin panel id or does not exist`),
          { name: 'PanelNotFoundError' },
        )
      }

      const currentPanel = cfg.panels.find((p) => p.id === panelId)!
      const nextPanelInput: PanelInput = typeof patch === 'function'
        ? patch(currentPanel)
        : { ...currentPanel, ...patch }

      if (nextPanelInput.id !== panelId) {
        throw Object.assign(new Error('updatePanel cannot change panel id'), { name: 'PanelValidationError' })
      }

      const nextConfig = DashboardConfigSchema.parse({
        ...cfg,
        panels: cfg.panels.map((p) => p.id === panelId ? nextPanelInput : p),
      })

      store.setState((s) => ({
        config: s.config ? nextConfig : null,
      }))
      emit({ type: 'config-changed', config: nextConfig })

      syncPanelInstances()

      const affectedIds = store.getState().panelInstances
        .filter((inst) => inst.originId === panelId)
        .map((inst) => inst.id)

      for (const id of affectedIds) {
        panelAbortControllers.get(id)?.abort()
        panelAbortControllers.delete(id)
      }

      if (invalidateCache) invalidatePanelCache(affectedIds)
      if (refresh) await Promise.all(affectedIds.map((id) => executePanel(id)))
    },

    // P3-2: run a temporary query without mutating panel state or cache
    async previewPanel(panelId: string, tempPanel: PanelInput, options = {}) {
      const { variablesOverride = {}, signal: callerSignal } = options
      const cfg = store.getState().config
      if (!cfg) throw new Error('no dashboard loaded')

      const parsedTempPanel = PanelConfigSchema.parse(tempPanel)
      const activeRequests = parsedTempPanel.dataRequests.filter((r) => !r.hide)
      if (activeRequests.length === 0) return { data: null as unknown, rawData: [] }

      const effectiveVariables = { ...buildCtxVariables(), ...variablesOverride }
      const tr = stateStore.getSnapshot().timeRange

      const controller = new AbortController()
      if (callerSignal) {
        if (callerSignal.aborted) throw abortError()
        callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      const previewInstance: PanelRuntimeInstance = findPanelInstance(panelId) ?? {
        id: panelId,
        originId: panelId,
        config: parsedTempPanel,
        type: parsedTempPanel.type,
        title: parsedTempPanel.title,
        gridPos: parsedTempPanel.gridPos,
      }

      const rawData = await Promise.all(
        activeRequests.map(async (request) => {
          const dsDef = datasourceRegistry.getForRequest(request)
          await ensurePanelDataRequestAuthorized(cfg, parsedTempPanel, request, request.uid)
          if (controller.signal.aborted) throw abortError()
          const result = await dsDef.query({
            dataRequest: request,
            dashboardId: cfg.id,
            panelId,
            requestId: request.id,
            ...(request.query !== undefined ? { query: request.query } : {}),
            requestOptions: request.options,
            variables: effectiveVariables,
            datasourceOptions: dsDef.options ?? ({} as never),
            authContext: store.getState().authContext,
            ...(tr !== undefined ? { timeRange: tr } : {}),
            signal: controller.signal,
            builtins: varEngine.getBuiltins(),
            panel: parsedTempPanel,
            panelOptions: parsedTempPanel.options,
            panelInstance: previewInstance,
          })
          return { ...result, requestId: request.id }
        }),
      )

      const panelDef = panelMap.get(parsedTempPanel.type)
      const data = panelDef?.transform ? panelDef.transform(rawData) : rawData
      return { data, rawData }
    },

    async previewDataRequest(request: DataRequestInput, options = {}) {
      const { panelId, variablesOverride = {}, signal: callerSignal } = options
      const cfg = store.getState().config
      if (!cfg) throw new Error('no dashboard loaded')

      const parsedRequest = DataRequestSchema.parse(request)
      const panelInstance = panelId ? findPanelInstance(panelId) : undefined
      const panelConfig = panelInstance?.config
      const effectiveVariables = { ...buildCtxVariables(), ...variablesOverride }
      const tr = stateStore.getSnapshot().timeRange

      const controller = new AbortController()
      if (callerSignal) {
        if (callerSignal.aborted) throw abortError()
        callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      const dsDef = datasourceRegistry.getForRequest(parsedRequest)
      await ensurePreviewDataRequestAuthorized(cfg, parsedRequest, panelConfig)
      if (controller.signal.aborted) throw abortError()

      const result = await dsDef.query({
        dataRequest: parsedRequest,
        dashboardId: cfg.id,
        panelId: panelId ?? '',
        requestId: parsedRequest.id,
        ...(parsedRequest.query !== undefined ? { query: parsedRequest.query } : {}),
        requestOptions: parsedRequest.options,
        variables: effectiveVariables,
        datasourceOptions: dsDef.options ?? ({} as never),
        authContext: store.getState().authContext,
        ...(tr !== undefined ? { timeRange: tr } : {}),
        signal: controller.signal,
        builtins: varEngine.getBuiltins(),
        ...(panelConfig ? { panel: panelConfig, panelOptions: panelConfig.options } : {}),
        ...(panelInstance ? { panelInstance } : {}),
      })
      return { ...result, requestId: parsedRequest.id }
    },

    validatePanelOptions(type, options) {
      const panelDef = panelMap.get(type)
      if (!panelDef) {
        return {
          valid: false,
          errors: [{ path: ['type'], message: `panel type "${type}" is not registered` }],
        }
      }
      return validateOptionSchema(panelDef.optionsSchema, options)
    },

    validateDataRequest(request) {
      const parsed = DataRequestSchema.safeParse(request)
      if (parsed.success) return { valid: true, errors: [] }

      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String),
          message: issue.message,
        })),
      }
    },

    setTimeRange(range) { stateStore.setPatch({ timeRange: range }) },
    getTimeRange() { return stateStore.getSnapshot().timeRange },
    setRefresh(refresh) { stateStore.setPatch({ refresh }) },
    getRefresh() { return stateStore.getSnapshot().refresh },

    setAuthContext(context) {
      store.setState({ authContext: context })
      clearCache()
      void api.refreshVariables()
    },

    getAuthContext() { return store.getState().authContext },

    // ─── Cross-filter ───────────────────────────────────────────────────────────
    setPanelSelection(panelId, filters) {
      panelSelections.set(panelId, filters)
      emit({ type: 'panel-selection-changed', panelId, selection: filters })
      clearCache()
      void api.refreshAll()
    },

    clearPanelSelection(panelId) {
      if (!panelSelections.has(panelId)) return
      panelSelections.delete(panelId)
      emit({ type: 'panel-selection-changed', panelId, selection: null })
      clearCache()
      void api.refreshAll()
    },

    clearAllPanelSelections() {
      if (panelSelections.size === 0) return
      const ids = [...panelSelections.keys()]
      panelSelections.clear()
      for (const panelId of ids) {
        emit({ type: 'panel-selection-changed', panelId, selection: null })
      }
      clearCache()
      void api.refreshAll()
    },

    getPanelSelections() {
      const result: Record<string, Record<string, string | string[]>> = {}
      for (const [panelId, filters] of panelSelections) result[panelId] = { ...filters }
      return result
    },

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
