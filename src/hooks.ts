import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import type { CoreEngineAPI } from './define'
import type { DashboardConfig, DashboardInput, EngineEvent, PanelState, VariableState } from './types'

// ─── Internal Store Access Helper ───────────────────────────────────────────────

interface EngineStore {
  config: DashboardConfig | null
  variables: Record<string, VariableState>
  panels: Record<string, PanelState>
  timeRange: { from: string; to: string } | undefined
}

type EngineWithStore = CoreEngineAPI & {
  _store: StoreApi<EngineStore>
}

function getStore(engine: CoreEngineAPI): StoreApi<EngineStore> {
  return (engine as EngineWithStore)._store
}

// ─── useDashboard ───────────────────────────────────────────────────────────────
// Main dashboard entry point. Loads config and returns full variable/time-range state.

export interface UseDashboardResult {
  variables: Record<string, VariableState>
  timeRange: { from: string; to: string } | undefined
  setVariable: (name: string, value: string | string[]) => void
  setTimeRange: (range: { from: string; to: string }) => void
  refreshAll: () => Promise<void>
}

export function useDashboard(engine: CoreEngineAPI, config: DashboardInput): UseDashboardResult {
  const configLoadedRef = useRef(false)

  // Load only on first render
  if (!configLoadedRef.current) {
    engine.load(config)
    configLoadedRef.current = true
  }

  const store = getStore(engine)

  const [state, setState] = useState(() => store.getState())

  useEffect(() => {
    // Sync with latest state on mount
    setState(store.getState())
    // Subscribe to Zustand store

    return store.subscribe((s) => setState(s))
  }, [store])

  const setVariable = useCallback(
    (name: string, value: string | string[]) => engine.setVariable(name, value),
    [engine],
  )

  const setTimeRange = useCallback(
    (range: { from: string; to: string }) => engine.setTimeRange(range),
    [engine],
  )

  const refreshAll = useCallback(() => engine.refreshAll(), [engine])

  return {
    variables: state.variables,
    timeRange: state.timeRange,
    setVariable,
    setTimeRange,
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
  rawData: import('./types').QueryResult | null
  loading: boolean
  error: string | null
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
