import type { StoreApi } from 'zustand/vanilla'
import type { CoreEngineAPI } from '../schema'
import type { DashboardConfig, PanelRuntimeInstance, PanelState, VariableState } from '../schema'

// Subset of the engine's internal Zustand store that React adapters need.
// Intentionally omits authContext and other engine-internal fields.
export interface EngineStore {
  config: DashboardConfig | null
  variables: Record<string, VariableState>
  panels: Record<string, PanelState>
  panelInstances: PanelRuntimeInstance[]
  timeRange: { from: string; to: string } | undefined
  refresh: string | undefined
}

type EngineWithStore = CoreEngineAPI & { _store: StoreApi<EngineStore> }

export function getStore(engine: CoreEngineAPI): StoreApi<EngineStore> {
  return (engine as EngineWithStore)._store
}
