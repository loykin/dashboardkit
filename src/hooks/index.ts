import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createEditorAddon } from '../addons/editor'
import type { CoreEngineAPI } from '../schema'
import type {
  Annotation,
  DashboardConfig,
  DashboardInput,
  DashboardLoadOptions,
  EngineEvent,
  PanelInput,
  PanelPatchInput,
  PanelRuntimeInstance,
  PanelState,
  VariableOption,
  VariableState,
} from '../schema'
import { getStore } from '../internal/store-access'

function sameLoadOptions(
  left: DashboardLoadOptions | undefined,
  right: DashboardLoadOptions | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.statePolicy === right.statePolicy && left.state === right.state
}

// ─── useLoadDashboard ───────────────────────────────────────────────────────────
// Load external dashboard config into the engine (one-way boundary).
// Call this at the app/router level. Does not subscribe to engine state.

export function useLoadDashboard(
  engine: CoreEngineAPI,
  config: DashboardInput,
  loadOptions?: DashboardLoadOptions,
): void {
  const loadedConfigRef = useRef<DashboardInput | null>(null)
  const loadOptionsRef = useRef<DashboardLoadOptions | undefined>(undefined)

  useEffect(() => {
    if (loadedConfigRef.current === config && sameLoadOptions(loadOptionsRef.current, loadOptions)) {
      return
    }
    engine.load(config, loadOptions)
    loadedConfigRef.current = config
    loadOptionsRef.current = loadOptions
  }, [engine, config, loadOptions])
}

// ─── useDashboard ───────────────────────────────────────────────────────────────
// Subscribe to engine runtime state only. Does not load config.
// Use useLoadDashboard() separately to push config into the engine.

export interface UseDashboardResult {
  variables: Record<string, VariableState>
  timeRange: { from: string; to: string } | undefined
  refresh: string | undefined
  setVariable: (name: string, value: string | string[]) => void
  refreshAll: () => Promise<void>
}

export function useDashboard(engine: CoreEngineAPI): UseDashboardResult {
  const store = getStore(engine)

  const [state, setState] = useState(() => store.getState())

  useEffect(() => {
    setState(store.getState())
    return store.subscribe((s) => setState(s))
  }, [store])

  const setVariable = useCallback(
    (name: string, value: string | string[]) => engine.setVariable(name, value),
    [engine],
  )

  const refreshAll = useCallback(() => engine.refreshAll(), [engine])

  return {
    variables: state.variables,
    timeRange: state.timeRange,
    refresh: state.refresh,
    setVariable,
    refreshAll,
  }
}

// ─── useVariable ────────────────────────────────────────────────────────────────
// Subscribe to a single variable's value, options, and loading state.

export interface UseVariableResult {
  value: string | string[]
  options: { label: string; value: string }[]
  loading: boolean
  error: string | null
  setValue: (value: string | string[]) => void
}

export function useVariable(engine: CoreEngineAPI, name: string): UseVariableResult {
  const store = getStore(engine)

  const [varState, setVarState] = useState<VariableState>(
    () => store.getState().variables[name] ?? {
      name,
      type: '',
      value: '',
      options: [],
      loading: false,
      error: null,
      status: 'idle',
    },
  )

  useEffect(() => {
    setVarState(
      store.getState().variables[name] ?? {
        name,
        type: '',
        value: '',
        options: [],
        loading: false,
        error: null,
        status: 'idle',
      },
    )

    return store.subscribe((s) => {
      const next = s.variables[name]
      if (next) setVarState(next)
    })
  }, [store, name])

  const setValue = useCallback(
    (value: string | string[]) => engine.setVariable(name, value),
    [engine, name],
  )

  return {
    value: varState.value,
    options: varState.options,
    loading: varState.loading,
    error: varState.error,
    setValue,
  }
}

// ─── usePanel ───────────────────────────────────────────────────────────────────
// Subscribe to a single panel's data/rawData/loading/error state.
// Automatically manages active state via IntersectionObserver.

export interface UsePanelResult<TData = unknown> {
  data: TData
  rawData: import('../schema/types').QueryResult[] | null
  loading: boolean
  error: string | null
  streaming: boolean
  /** Panel DOM ref — attach to the panel root element to enable viewport virtualization */
  ref: React.RefCallback<HTMLElement>
}

export function usePanel<TData = unknown>(
  engine: CoreEngineAPI,
  panelId: string,
): UsePanelResult<TData> {
  const store = getStore(engine)

  const [panelState, setPanelState] = useState<PanelState>(
    () => store.getState().panels[panelId] ?? {
      id: panelId,
      data: null,
      rawData: null,
      loading: false,
      error: null,
      width: 0,
      height: 0,
      active: true,
    },
  )

  useEffect(() => {
    setPanelState(
      store.getState().panels[panelId] ?? {
        id: panelId,
        data: null,
        rawData: null,
        loading: false,
        error: null,
        width: 0,
        height: 0,
        active: true,
      },
    )

    return store.subscribe((s) => {
      const next = s.panels[panelId]
      if (next) setPanelState(next)
    })
  }, [store, panelId])

  // IntersectionObserver — toggle active state on viewport enter/exit
  const observerRef = useRef<IntersectionObserver | null>(null)
  const elementRef = useRef<HTMLElement | null>(null)

  const refCallback = useCallback(
    (el: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      elementRef.current = el
      if (!el) return

      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          const active = entry?.isIntersecting ?? false
          const cur = store.getState().panels[panelId]
          if (!cur || cur.active === active) return
          // Update active state
          store.setState((s) => ({
            panels: { ...s.panels, [panelId]: { ...s.panels[panelId]!, active } },
          }))
          // Refresh immediately when entering the viewport
          if (active) void engine.refreshPanel(panelId)
        },
        { threshold: 0.01 },
      )
      observerRef.current.observe(el)
    },
    [store, engine, panelId],
  )

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return {
    data: panelState.data as TData,
    rawData: panelState.rawData,
    loading: panelState.loading,
    error: panelState.error,
    streaming: panelState.streaming,
    ref: refCallback,
  }
}

// ─── useEngineEvent ─────────────────────────────────────────────────────────────
// Subscribe to engine events (for logging, notifications, or other side effects)

export function useEngineEvent(
  engine: CoreEngineAPI,
  handler: (event: EngineEvent) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return engine.subscribe((e) => handlerRef.current(e))
  }, [engine])
}

// ─── usePanelDraftEditor ────────────────────────────────────────────────────────
// Editor hook: local draft state separate from committed engine config.
//
// Draft lifecycle:
//   - draft is null until setDraft() is called (null = "no changes")
//   - draft resets to null when panelId changes (switching panels discards unsaved work)
//   - apply() commits the current draft via engine.updatePanel(); no-op when draft is null
//     (caller should guard: "no draft = no unsaved changes = nothing to apply")
//   - preview() runs a data fetch against the current draft if one exists,
//     otherwise falls back to the committed config
//
// setDraft() merges the patch shallowly into the current draft (or committed config).
// Top-level keys (title, options, dataRequests, gridPos, …) are replaced in full.
// For nested objects (options, dataRequests), pass the complete updated value — do not
// rely on deep merging.

export interface UsePanelDraftEditorResult {
  instance: PanelRuntimeInstance | null
  draftPanel: PanelInput | null
  setDraft(patch: PanelPatchInput): void
  resetDraft(): void
  apply(): Promise<void>
  preview(): Promise<{ data: unknown; rawData: import('../schema/types').QueryResult[] }>
}

export function usePanelDraftEditor(
  engine: CoreEngineAPI,
  panelId: string | null,
): UsePanelDraftEditorResult {
  const store = getStore(engine)
  const [instances, setInstances] = useState<PanelRuntimeInstance[]>(() => store.getState().panelInstances)

  useEffect(() => {
    setInstances(store.getState().panelInstances)
    return store.subscribe((s) => setInstances(s.panelInstances))
  }, [store])

  const instance = panelId ? (instances.find((p) => p.id === panelId) ?? null) : null

  const [draftPanel, setDraftPanel] = useState<PanelInput | null>(null)

  useEffect(() => {
    setDraftPanel(null)
  }, [panelId])

  const setDraft = useCallback(
    (patch: PanelPatchInput) => {
      setDraftPanel((prev) => {
        const base = prev ?? instance?.config ?? null
        if (!base) return prev
        return { ...base, ...patch } as PanelInput
      })
    },
    [instance],
  )

  const resetDraft = useCallback(() => {
    setDraftPanel(null)
  }, [])

  const apply = useCallback((): Promise<void> => {
    if (!panelId || !draftPanel) return Promise.resolve()
    return engine.updatePanel(panelId, draftPanel)
  }, [engine, panelId, draftPanel])

  const preview = useCallback((): Promise<{ data: unknown; rawData: import('../schema/types').QueryResult[] }> => {
    if (!panelId) return Promise.resolve({ data: null as unknown, rawData: [] })
    const panel = draftPanel ?? instance?.config
    if (!panel) return Promise.resolve({ data: null as unknown, rawData: [] })
    return createEditorAddon(engine).previewPanel(panelId, panel)
  }, [engine, panelId, draftPanel, instance])

  return { instance, draftPanel, setDraft, resetDraft, apply, preview }
}

// ─── useVariableEditor ──────────────────────────────────────────────────────────
// Editor hook: full variable state + refresh trigger for variable picker UIs.

export interface UseVariableEditorResult {
  state: VariableState
  options: VariableOption[]
  setValue(value: string | string[]): void
  refresh(): Promise<boolean>
}

function defaultVarState(name: string): VariableState {
  return { name, type: '', value: '', options: [], loading: false, error: null, status: 'idle' }
}

export function useVariableEditor(
  engine: CoreEngineAPI,
  name: string,
): UseVariableEditorResult {
  const store = getStore(engine)
  const [varState, setVarState] = useState<VariableState>(
    () => store.getState().variables[name] ?? defaultVarState(name),
  )

  useEffect(() => {
    setVarState(store.getState().variables[name] ?? defaultVarState(name))
    return store.subscribe((s) => {
      const next = s.variables[name]
      if (next) setVarState(next)
    })
  }, [store, name])

  const setValue = useCallback(
    (value: string | string[]) => engine.setVariable(name, value),
    [engine, name],
  )

  const refresh = useCallback(
    () => engine.refreshVariable(name),
    [engine, name],
  )

  return { state: varState, options: varState.options, setValue, refresh }
}

// ─── useOptionsChange ────────────────────────────────────────────────────────────
// Helper for partial panel options updates in editor UIs.
// Returns a stable updater that merges a partial patch into the current options object.

export function useOptionsChange<T extends object>(
  options: T,
  onOptionsChange: ((newOptions: T) => void) | undefined,
): (patch: Partial<T>) => void {
  return useCallback(
    (patch: Partial<T>) => onOptionsChange?.({ ...options, ...patch }),
    [options, onOptionsChange],
  )
}

// ─── useConfigChanged ────────────────────────────────────────────────────────────
// Subscribe to config-changed events (e.g. to track unsaved changes in the app layer).

export function useConfigChanged(
  engine: CoreEngineAPI,
  handler: (config: DashboardConfig) => void,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    return engine.subscribe((e) => {
      if (e.type === 'config-changed') handlerRef.current(e.config)
    })
  }, [engine])
}

// ─── useImeInput ─────────────────────────────────────────────────────────────
// Uncontrolled input helper that is safe with CJK IME composition in Safari.
//
// React's controlled inputs (value + onChange) reset input.value on every
// render, which interrupts in-progress IME composition. This causes spurious
// onChange events with intermediate/uncommitted characters in Safari.
//
// useImeInput returns:
//   ref     — attach to <input ref={ref} defaultValue={...} /> (no value prop)
//   getValue — read the browser-committed value at any time (e.g. on submit)
//   reset    — imperatively set input.value (e.g. when the edited item changes)

export interface UseImeInputResult {
  ref: RefObject<HTMLInputElement | null>
  getValue(): string
  reset(value: string): void
}

// ─── useAnnotations ─────────────────────────────────────────────────────────────
// Fetch annotation events for the current time range.
// Refetches when the engine fires time-range-changed events.

export interface UseAnnotationsResult {
  annotations: Annotation[]
  loading: boolean
  error: string | null
  refresh(): void
}

export function useAnnotations(
  engine: CoreEngineAPI,
  timeRange?: { from: string; to: string },
): UseAnnotationsResult {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeRangeRef = useRef(timeRange)
  timeRangeRef.current = timeRange

  const fetch = useCallback(() => {
    setLoading(true)
    setError(null)
    engine.queryAnnotations(timeRangeRef.current).then(
      (result) => { setAnnotations(result); setLoading(false) },
      (err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setLoading(false) },
    )
  }, [engine])

  useEffect(() => {
    fetch()
    return engine.subscribe((e) => {
      if (e.type === 'time-range-changed') fetch()
    })
  }, [engine, fetch])

  return { annotations, loading, error, refresh: fetch }
}

export function useImeInput(initialValue: string): UseImeInputResult {
  const ref = useRef<HTMLInputElement>(null)
  const initialValueRef = useRef(initialValue)
  initialValueRef.current = initialValue

  const getValue = useCallback((): string => {
    return ref.current?.value ?? initialValueRef.current
  }, [])

  const reset = useCallback((value: string): void => {
    if (ref.current) ref.current.value = value
  }, [])

  return { ref, getValue, reset }
}
