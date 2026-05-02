import type { CoreEngineAPI } from '../schema'

export interface LayoutAddon {
  toggleRow(panelId: string): Promise<void>
}

export function createLayoutAddon(engine: CoreEngineAPI): LayoutAddon {
  return {
    async toggleRow(panelId) {
      const cfg = engine.getConfig()
      if (!cfg) return

      const row = cfg.panels.find((p) => p.id === panelId)
      if (!row?.isRow) {
        throw Object.assign(
          new Error(`Panel "${panelId}" is not a row panel or does not exist`),
          { name: 'PanelNotFoundError' },
        )
      }

      const beforeIds = new Set(engine.getPanelInstances().map((p) => p.id))
      await engine.updatePanel(
        panelId,
        { collapsed: !row.collapsed },
        { refresh: false, invalidateCache: false },
      )

      const nextRow = engine.getConfig()?.panels.find((p) => p.id === panelId)
      if (!nextRow || nextRow.collapsed) return

      const newlyVisible = engine.getPanelInstances()
        .map((p) => p.id)
        .filter((id) => !beforeIds.has(id))

      await Promise.all(newlyVisible.map((id) => engine.refreshPanel(id)))
    },
  }
}
