import type { DashboardConfig, GridPos, PanelExpander, PanelRuntimeInstance } from './types'

// ─── ID / position helpers ──────────────────────────────────────────────────────

export function runtimePanelId(originId: string, index: number): string {
  return index === 0 ? originId : `${originId}__repeat__${index}`
}

export function repeatGridPos(
  origin: GridPos,
  index: number,
  direction: 'h' | 'v',
  cols: number,
): GridPos {
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

// ─── Built-in repeat expander ───────────────────────────────────────────────────

export const repeatExpander: PanelExpander = {
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

// ─── Expansion pipeline ─────────────────────────────────────────────────────────

export function buildBasePanelInstances(cfg: DashboardConfig): PanelRuntimeInstance[] {
  return cfg.panels.map((panel) => ({
    id: panel.id,
    originId: panel.id,
    config: panel,
    type: panel.type,
    title: panel.title,
    gridPos: panel.gridPos,
  }))
}

export function buildPanelExpanders(customExpanders: PanelExpander[]): PanelExpander[] {
  return [repeatExpander, ...customExpanders]
}
