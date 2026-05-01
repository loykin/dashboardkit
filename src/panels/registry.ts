import type {
  PanelEditorProps,
  PanelPluginDef,
  PanelViewerProps,
  PluginComponent,
} from '../plugins'

export interface PanelRegistry {
  get(type: string): PanelPluginDef | undefined
  list(): PanelPluginDef[]
  has(type: string): boolean
  getViewer(type: string): PluginComponent<PanelViewerProps<unknown, unknown>> | undefined
  getEditor(type: string): PluginComponent<PanelEditorProps<unknown>> | undefined
}

export function createPanelRegistry(plugins: readonly PanelPluginDef[]): PanelRegistry {
  const byType = new Map<string, PanelPluginDef>()

  for (const plugin of plugins) {
    byType.set(plugin.id, plugin)
  }

  return {
    get(type) {
      return byType.get(type)
    },

    list() {
      return [...byType.values()]
    },

    has(type) {
      return byType.has(type)
    },

    getViewer(type) {
      return byType.get(type)?.viewer as
        | PluginComponent<PanelViewerProps<unknown, unknown>>
        | undefined
    },

    getEditor(type) {
      return byType.get(type)?.editor as
        | PluginComponent<PanelEditorProps<unknown>>
        | undefined
    },
  }
}
