import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { parseRefs } from './parser'
import type {
  DashboardConfig,
  DashboardInput,
  VariableState,
  PanelState,
  QueryResult,
  EngineEvent,
  AuthContext,
  AuthorizationDecision,
  AuthorizationRequest,
  PermissionAction,
  PermissionRule,
  DashboardStateSnapshot,
  PanelRuntimeInstance,
  PanelExpander,
  GridPos,
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

// ─── Built-in Panel Expansion ─────────────────────────────────────────────────

function runtimePanelId(originId: string, index: number): string {
  return index === 0 ? originId : `${originId}__repeat__${index}`
}

function repeatGridPos(origin: GridPos, index: number, direction: 'h' | 'v', cols: number): GridPos {
  if (index === 0) return origin
  if (direction === 'v') return { ...origin, y: origin.y + origin.h * index }

  const rawX = origin.x + origin.w * index
  const wraps = Math.floor(rawX / cols)
  return {
    ...origin,
    x: rawX % cols,
    y: origin.y + origin.h * wraps,
  }
}

const repeatExpander: PanelExpander = {
  id: 'repeat',
  expand(input, ctx) {
    const instances: PanelRuntimeInstance[] = []
    const cols = ctx.dashboard.layout.cols

    for (const base of input) {
      const panel = base.config
      if (!panel.repeat) {
        instances.push(base)
        continue
      }

      const raw = ctx.variables[panel.repeat]
      const values = Array.isArray(raw) ? raw : raw ? [raw] : []

      for (let i = 0; i < values.length; i += 1) {
        const value = values[i]!
        instances.push({
          id: runtimePanelId(panel.id, i),
          originId: panel.id,
          config: panel,
          type: panel.type,
          title: panel.title,
          gridPos: repeatGridPos(panel.gridPos, i, panel.repeatDirection, cols),
          variablesOverride: { [panel.repeat]: value },
          repeat: {
            varName: panel.repeat,
            value,
            index: i,
            direction: panel.repeatDirection,
          },
        })
      }
    }

    return instances
  },
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
  } =
    options

  // Plugin maps — keyed by uid for direct lookup (panel.dataRequests[].uid → plugin)
  const dsMap = new Map<string, DatasourcePluginDef>(dsDefs.map((d) => [d.uid, d]))
  const panelMap = new Map<string, PanelPluginDef>(panelDefs.map((p) => [p.id, p]))

  // Query cache: `dsId::interpolatedQuery::from::to` → QueryResult
  const cache = new Map<string, CacheEntry>()
  const panelExpanders: PanelExpander[] = [repeatExpander, ...customPanelExpanders]

  // Event listeners
  const listeners = new Set<(e: EngineEvent) => void>()
  const emit = (e: EngineEvent) => listeners.forEach((l) => l(e))

  // Zustand vanilla store
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

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function buildCtxVariables(): Record<string, string | string[]> {
    return varEngine.getVariables()
  }

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

  function rulesForAction(rules: PermissionRule[], action: PermissionAction): PermissionRule[] {
    return rules.filter((rule) => rule.action === action || rule.action === '*')
  }

  function intersects(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
    if (!left || left.length === 0) return true
    if (!right || right.length === 0) return false
    return left.some((value) => right.includes(value))
  }

  function ruleMatches(rule: PermissionRule, ctx: AuthContext): boolean {
    const subject = ctx.subject
    if (rule.subjects && (!subject?.id || !rule.subjects.includes(subject.id))) return false
    if (!intersects(rule.roles, subject?.roles)) return false
    return intersects(rule.groups, subject?.groups);

  }

  function defaultAuthorize(request: AuthorizationRequest): AuthorizationDecision {
    const matchingRules = rulesForAction(request.permissions, request.action)
    if (matchingRules.length === 0) return { allowed: true }

    const matched = matchingRules.filter((rule) => ruleMatches(rule, request.authContext))
    const deny = matched.find((rule) => rule.effect === 'deny')
    if (deny) return { allowed: false, reason: deny.reason ?? 'authorization denied' }

    const allow = matched.find((rule) => rule.effect === 'allow')
    if (allow) return { allowed: true }

    return { allowed: false, reason: 'authorization denied' }
  }

  async function authorize(request: Omit<AuthorizationRequest, 'authContext'>): Promise<AuthorizationDecision> {
    const fullRequest: AuthorizationRequest = {
      ...request,
      authContext: store.getState().authContext,
    }
    const decision = customAuthorize
      ? await customAuthorize(fullRequest)
      : defaultAuthorize(fullRequest)
    return typeof decision === 'boolean' ? { allowed: decision } : decision
  }

  async function ensureAuthorized(request: Omit<AuthorizationRequest, 'authContext'>): Promise<void> {
    const decision = await authorize(request)
    if (decision.allowed) return

    const resourceId =
      request.panel?.id ??
      request.variable?.name ??
      request.datasourceUid ??
      request.dashboard.id
    const reason = decision.reason ?? 'authorization denied'
    emit({ type: 'authorization-denied', action: request.action, resourceId, reason })
    throw new Error(reason)
  }

  function valuesEqual(a: string | string[] | undefined, b: string | string[] | undefined): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    }
    return a === b
  }

  function getDatasourceDef(request: import('./types').DataRequestConfig): DatasourcePluginDef {
    const dsDef = dsMap.get(request.uid)
    if (!dsDef) throw new Error(`datasource "${request.uid}" not registered in engine`)
    if (dsDef.type !== request.type) {
      throw new Error(`datasource "${request.uid}" type mismatch: expected "${request.type}", got "${dsDef.type}"`)
    }
    return dsDef
  }

  function buildDefaultStatePatch(cfg: DashboardConfig): import('./types').DashboardStatePatch {
    const snapshot = stateStore.getSnapshot()
    const variables: Record<string, string | string[] | undefined> = {}
    // Initialize only variables declared by this dashboard. Do not prune
    // unknown variables: URL/query state is app-owned and may contain values
    // used by routers, auth flows, embedding, or another dashboard.
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

  function buildBasePanelInstances(cfg: DashboardConfig): PanelRuntimeInstance[] {
    return cfg.panels.map((panel) => ({
      id: panel.id,
      originId: panel.id,
      config: panel,
      type: panel.type,
      title: panel.title,
      gridPos: panel.gridPos,
    }))
  }

  function buildPanelInstances(): PanelRuntimeInstance[] {
    const cfg = store.getState().config
    if (!cfg) return []

    const ctx = {
      dashboard: cfg,
      variables: buildCtxVariables(),
    }

    return panelExpanders.reduce(
      (instances, expander) => expander.expand(instances, ctx),
      buildBasePanelInstances(cfg),
    )
  }

  function defaultPanelState(id: string): PanelState {
    return {
      id,
      data: null,
      rawData: null,
      loading: false,
      error: null,
      width: 0,
      height: 0,
      active: true,
    }
  }

  function syncPanelInstances(): void {
    const nextInstances = buildPanelInstances()
    const nextIds = new Set(nextInstances.map((p) => p.id))

    store.setState((s) => {
      const panels = { ...s.panels }

      for (const id of Object.keys(panels)) {
        if (!nextIds.has(id)) delete panels[id]
      }

      for (const instance of nextInstances) {
        panels[instance.id] ??= defaultPanelState(instance.id)
      }

      return { panelInstances: nextInstances, panels }
    })
  }

  function findPanelInstance(instanceId: string): PanelRuntimeInstance | undefined {
    return store.getState().panelInstances.find((instance) => instance.id === instanceId)
  }

  function panelRefsVar(instance: PanelRuntimeInstance, varName: string): boolean {
    const panel = instance.config
    const inTitle = panel.title ? parseRefs(panel.title).refs.includes(varName) : false
    const inDataRequests = panel.dataRequests.some((request) => JSON.stringify(request).includes('$' + varName))
    const isRepeatVar = panel.repeat === varName
    return inTitle || inDataRequests || isRepeatVar
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
      return {
        variables,
        timeRange: snapshot.timeRange,
        refresh: snapshot.refresh,
      }
    })
  }

  function changedVariableNames(
    prev: DashboardStateSnapshot,
    next: DashboardStateSnapshot,
  ): string[] {
    const names = new Set([...Object.keys(prev.variables), ...Object.keys(next.variables)])
    return [...names].filter((name) => !valuesEqual(prev.variables[name], next.variables[name]))
  }

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
      await Promise.all(affected.map(executePanel))
    }

    if (timeChanged) {
      await api.refreshAll()
    }
  }

  function invalidatePanelCache(panelIds: string[]) {
    for (const pid of panelIds) {
      const pcfg = findPanelInstance(pid)?.config ?? store.getState().config?.panels.find((p) => p.id === pid)
      if (!pcfg) continue
      for (const request of pcfg.dataRequests) {
        const uid = request.uid
        for (const key of [...cache.keys()]) {
          if (key.startsWith(`${uid}::`)) cache.delete(key)
        }
      }
    }
  }

  async function ensurePanelDataRequestAuthorized(
    cfg: DashboardConfig,
    pcfg: import('./types').PanelConfig,
    dataRequest: import('./types').DataRequestConfig,
    datasourceUid: string,
  ): Promise<void> {
    const permissions = [...cfg.permissions, ...pcfg.permissions, ...dataRequest.permissions]
    await ensureAuthorized({
      action: 'panel:query',
      dashboard: cfg,
      panel: pcfg,
      dataRequest,
      datasourceUid,
      permissions,
    })
    await ensureAuthorized({
      action: 'datasource:query',
      dashboard: cfg,
      panel: pcfg,
      dataRequest,
      datasourceUid,
      permissions,
    })
  }

  async function ensureVariableDataRequestAuthorized(
    cfg: DashboardConfig,
    vcfg: import('./types').VariableConfig,
    dataRequest: import('./types').DataRequestConfig,
  ): Promise<void> {
    const permissions = [...cfg.permissions, ...vcfg.permissions, ...dataRequest.permissions]
    await ensureAuthorized({
      action: 'variable:query',
      dashboard: cfg,
      variable: vcfg,
      dataRequest,
      datasourceUid: dataRequest.uid,
      permissions,
    })
    await ensureAuthorized({
      action: 'datasource:query',
      dashboard: cfg,
      variable: vcfg,
      dataRequest,
      datasourceUid: dataRequest.uid,
      permissions,
    })
  }

  function panelsReferencingVar(varName: string): string[] {
    return store.getState().panelInstances
      .filter((instance) => panelRefsVar(instance, varName))
      .map((instance) => instance.id)
  }

  // ─── Panel Query Execution ──────────────────────────────────────────────────
  // Run each dataRequests[] entry in parallel, then pass all results to panelDef.transform.

  async function executePanel(panelId: string): Promise<void> {
    const cfg = store.getState().config
    if (!cfg) return
    const instance = findPanelInstance(panelId)
    if (!instance) return
    const pcfg = instance.config

    const panel = store.getState().panels[panelId]
    if (!panel?.active) return // skip panels outside the viewport

    const activeRequests = pcfg.dataRequests.filter((request) => !request.hide)
    if (activeRequests.length === 0) return

    try {
      const tr = stateStore.getSnapshot().timeRange
      const effectiveVariables = {
        ...buildCtxVariables(),
        ...(instance.variablesOverride ?? {}),
      }
      const flatVars = flattenVariables(effectiveVariables)

      for (const request of activeRequests) {
        getDatasourceDef(request)
        await ensurePanelDataRequestAuthorized(cfg, pcfg, request, request.uid)
      }

      // Check cache only after authorization, so denied users never receive stale data.
      const cachedResults: QueryResult[] = []
      let allCached = true
      for (const request of activeRequests) {
        const key = cacheKey(request.uid, JSON.stringify(request), flatVars, tr)
        const cached = cache.get(key)
        if (cached) {
          cachedResults.push({ ...cached.data, requestId: request.id })
        } else {
          allCached = false
          break
        }
      }

      if (allCached) {
        const panelDef = panelMap.get(pcfg.type)
        const data = panelDef?.transform
          ? panelDef.transform(cachedResults)
          : cachedResults
        store.setState((s) => ({
          panels: {
            ...s.panels,
            [panelId]: { ...s.panels[panelId]!, data, rawData: cachedResults, loading: false, error: null },
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

      const results = await Promise.all(
        activeRequests.map(async (request) => {
          const uid = request.uid
          const dsDef = getDatasourceDef(request)

          const key = cacheKey(uid, JSON.stringify(request), flatVars, tr)

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
          })

          cache.set(key, { data: result, ts: Date.now() })
          return { ...result, requestId: request.id }
        }),
      )

      const panelDef = panelMap.get(pcfg.type)
      const data = panelDef?.transform ? panelDef.transform(results) : results

      store.setState((s) => ({
        panels: {
          ...s.panels,
          [panelId]: { ...s.panels[panelId]!, data, rawData: results, loading: false, error: null },
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

  async function refreshVariables({ emitChanges }: { emitChanges: boolean }): Promise<void> {
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

    await api.refreshAll()
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

	  const api: CoreEngineAPI = {
	    load(config: DashboardInput) {
	      const parsed = DashboardConfigSchema.parse(config)
	      const defaultPatch = buildDefaultStatePatch(parsed)
	      suppressDashboardSnapshotEvents = true
	      if (Object.keys(defaultPatch).length > 0) {
	        stateStore.setPatch(defaultPatch)
	      }
	      const snapshot = stateStore.getSnapshot()
	      lastDashboardSnapshot = snapshot

	      // Initial panel state
	      const initPanels: Record<string, PanelState> = {}
	      for (const p of parsed.panels) {
        initPanels[p.id] = defaultPanelState(p.id)
      }

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

	      // Kick off initial variable refresh
	      void (async () => {
	        try {
	          await refreshVariables({ emitChanges: false })
	        } finally {
	          suppressDashboardSnapshotEvents = false
	        }
	      })()
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

      // Mutate only this dashboard variable. Other canonical URL/state keys are
      // intentionally preserved by DashboardStateStore patch semantics.
      stateStore.setPatch({ variables: { [name]: value } })
    },

	    refreshVariables() {
	      return refreshVariables({ emitChanges: true })
	    },

    getPanel(panelId) {
      return store.getState().panels[panelId]
    },

    getPanelInstances() {
      return [...store.getState().panelInstances]
    },

    getPanelInstance(panelId) {
      return findPanelInstance(panelId)
    },

    async refreshPanel(panelId) {
      invalidatePanelCache([panelId])
      await executePanel(panelId)
    },

    async refreshAll() {
      await Promise.all(store.getState().panelInstances.map((p) => executePanel(p.id)))
    },

    setTimeRange(range) {
      stateStore.setPatch({ timeRange: range })
    },

    getTimeRange() {
      return stateStore.getSnapshot().timeRange
    },

    setRefresh(refresh) {
      stateStore.setPatch({ refresh })
    },

    getRefresh() {
      return stateStore.getSnapshot().refresh
    },

    setAuthContext(context) {
      store.setState({ authContext: context })
      cache.clear()
      void api.refreshVariables()
    },

    getAuthContext() {
      return store.getState().authContext
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  // Expose Zustand store for external subscription (hooks)
  ;(api as CoreEngineAPI & { _store: StoreApi<EngineStore> })._store = store

  const unsubscribeStateStore = stateStore.subscribe((snapshot) => {
    if (suppressDashboardSnapshotEvents) {
      lastDashboardSnapshot = snapshot
      mirrorDashboardSnapshot(snapshot)
      return
    }
    void handleDashboardSnapshotChange(snapshot)
  })
  ;(api as CoreEngineAPI & { _unsubscribeStateStore: () => void })._unsubscribeStateStore =
    unsubscribeStateStore

  return api
}
