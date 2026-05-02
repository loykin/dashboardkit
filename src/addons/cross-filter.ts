import type { CoreEngineAPI } from '../schema'

export interface CrossFilterAddon {
  setPanelSelection(panelId: string, filters: Record<string, string | string[]>): void
  clearPanelSelection(panelId: string): void
  clearAllPanelSelections(): void
  getPanelSelections(): Record<string, Record<string, string | string[]>>
}

export function createCrossFilterAddon(engine: CoreEngineAPI): CrossFilterAddon {
  return {
    setPanelSelection(panelId, filters) {
      engine.setPanelQueryScope(panelId, filters)
      engine.invalidateCache()
      void engine.refreshAll()
    },

    clearPanelSelection(panelId) {
      engine.setPanelQueryScope(panelId, null)
      engine.invalidateCache()
      void engine.refreshAll()
    },

    clearAllPanelSelections() {
      const scopes = engine.getPanelQueryScopes()
      if (Object.keys(scopes).length === 0) return
      for (const id of Object.keys(scopes)) {
        engine.setPanelQueryScope(id, null)
      }
      engine.invalidateCache()
      void engine.refreshAll()
    },

    getPanelSelections() {
      return engine.getPanelQueryScopes()
    },
  }
}
