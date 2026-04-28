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
  AuthContext,
  AuthorizationDecision,
  AuthorizationRequest,
  PermissionAction,
  PermissionRule,
  DashboardStateSnapshot,
} from './types'
import { DashboardConfigSchema } from './types'
import { createMemoryDashboardStateStore } from './state'
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
    datasources: dsDefs,
    variableTypes: vtDefs,
    builtinVariables = [],
    stateStore = createMemoryDashboardStateStore(),
    authContext = {},
    authorize: customAuthorize,
  } =
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
    authContext,
  }))

  // Topologically sorted variable execution order
  let sortedVarNames: string[] = []
  let lastDashboardSnapshot: DashboardStateSnapshot = stateStore.getSnapshot()
  let suppressDashboardSnapshotEvents = false

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getBuiltinCtx(): BuiltinContext {
    const tr = stateStore.getSnapshot().timeRange ?? { from: new Date().toISOString(), to: new Date().toISOString() }
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
    return { ...stateStore.getSnapshot().variables }
  }

  function cacheKey(dsUid: string, targetJson: string, tr?: { from: string; to: string }): string {
    const authKey = store.getState().authContext.subject?.id ?? 'anonymous'
    return `${dsUid}::${authKey}::${targetJson}::${tr?.from ?? ''}::${tr?.to ?? ''}`
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

  // Extract datasource uid from target — the only target field the library knows
  // target.datasource is a known field of TargetSchema so typed access is safe
  function resolveTargetDsUid(target: import('./types').Target, panelDsUid?: string): string | undefined {
    return target.datasource?.uid ?? panelDsUid
  }

  function valuesEqual(a: string | string[] | undefined, b: string | string[] | undefined): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    }
    return a === b
  }

  function snapshotVarValue(snapshot: DashboardStateSnapshot, name: string): string | string[] | undefined {
    return snapshot.variables[name]
  }

  function defaultVariableValue(v: import('./types').VariableConfig): string | string[] {
    return v.defaultValue ?? (v.multi ? [] : '')
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

    for (const name of changedVars) {
      const value = snapshot.variables[name]
      if (value !== undefined) emit({ type: 'variable-changed', name, value })
    }

    if (timeChanged && snapshot.timeRange) {
      emit({ type: 'time-range-changed', range: snapshot.timeRange })
      cache.clear()
    }

    if (changedVars.length > 0) {
      const downstream = new Set<string>()
      for (const changed of changedVars) {
        const idx = sortedVarNames.indexOf(changed)
        if (idx === -1) continue
        for (const name of sortedVarNames.slice(idx + 1)) {
          const vcfg = cfg.variables.find((v) => v.name === name)
          if (vcfg?.query && parseRefs(vcfg.query).refs.includes(changed)) downstream.add(name)
        }
      }
      for (const name of downstream) await resolveOneVariable(name)

      const affected = [...new Set(changedVars.flatMap((name) => panelsReferencingVar(name)))]
      invalidatePanelCache(affected)
      await Promise.all(affected.map(executePanel))
    }

    if (timeChanged) {
      await api.refreshAll()
    }
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

  async function ensureTargetQueryAuthorized(
    cfg: DashboardConfig,
    pcfg: import('./types').PanelConfig,
    target: import('./types').Target,
    datasourceUid: string,
  ): Promise<void> {
    const permissions = [...cfg.permissions, ...pcfg.permissions, ...target.permissions]
    await ensureAuthorized({
      action: 'panel:query',
      dashboard: cfg,
      panel: pcfg,
      target,
      datasourceUid,
      permissions,
    })
    await ensureAuthorized({
      action: 'datasource:query',
      dashboard: cfg,
      panel: pcfg,
      target,
      datasourceUid,
      permissions,
    })
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
        dashboard: { id: cfg.id, title: cfg.title },
        authContext: store.getState().authContext,
      }

      if (vcfg.datasourceId) {
        await ensureAuthorized({
          action: 'datasource:query',
          dashboard: cfg,
          variable: vcfg,
          datasourceUid: vcfg.datasourceId,
          permissions: [...cfg.permissions, ...vcfg.permissions],
        })
      }

      const newOptions = await vtDef.resolve(vcfg, options as never, resolveCtx)

      // Reset to first option if current value is no longer in the option list
      const cur = snapshotVarValue(stateStore.getSnapshot(), name)
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

      if (!valuesEqual(cur, newValue)) {
        stateStore.setPatch({ variables: { [name]: newValue } })
      }
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

    try {
      const tr = stateStore.getSnapshot().timeRange
      const flatVars = Object.fromEntries(
        Object.entries(buildCtxVariables()).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
      )

      const panelDsUid = pcfg.datasource?.uid

      for (const target of activeTargets) {
        const uid = resolveTargetDsUid(target, panelDsUid)
        if (!uid) continue
        await ensureTargetQueryAuthorized(cfg, pcfg, target, uid)
      }

      // Check cache only after authorization, so denied users never receive stale data.
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
            dashboardId: cfg.id,
            panelId,
            refId: target.refId,
            variables: flatVars,
            datasourceOptions: dsDef.options ?? ({} as never),
            authContext: store.getState().authContext,
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

      const defaultPatch = buildDefaultStatePatch(parsed)
      suppressDashboardSnapshotEvents = true
      try {
        if (Object.keys(defaultPatch).length > 0) {
          stateStore.setPatch(defaultPatch)
        }
      } finally {
        suppressDashboardSnapshotEvents = false
      }
      const snapshot = stateStore.getSnapshot()
      lastDashboardSnapshot = snapshot

      // Initial variable runtime state. Values mirror the canonical state store.
      const initVars: Record<string, VariableState> = {}
      for (const v of parsed.variables) {
        initVars[v.name] = {
          name: v.name,
          type: v.type,
          value: snapshot.variables[v.name] ?? defaultVariableValue(v),
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
        timeRange: snapshot.timeRange,
        authContext: store.getState().authContext,
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

      stateStore.setPatch({ variables: { [name]: value } })
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
      stateStore.setPatch({ timeRange: range })
    },

    getTimeRange() {
      return stateStore.getSnapshot().timeRange
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
      return
    }
    void handleDashboardSnapshotChange(snapshot)
  })
  ;(api as CoreEngineAPI & { _unsubscribeStateStore: () => void })._unsubscribeStateStore =
    unsubscribeStateStore

  return api
}
