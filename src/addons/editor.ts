import { PanelConfigSchema } from '../schema'
import type { CoreEngineAPI, DataRequestInput, PanelInput, QueryResult } from '../schema'

export interface EditorAddon {
  previewDataRequest(
    request: DataRequestInput,
    options?: {
      panelId?: string
      variablesOverride?: Record<string, string | string[]>
      signal?: AbortSignal
    },
  ): Promise<QueryResult>
  previewPanel(
    panelId: string,
    tempPanel: PanelInput,
    options?: {
      variablesOverride?: Record<string, string | string[]>
      signal?: AbortSignal
    },
  ): Promise<{ data: unknown; rawData: QueryResult[] }>
}

export function createEditorAddon(engine: CoreEngineAPI): EditorAddon {
  return {
    previewDataRequest(request, options) {
      return engine.executeDataRequest(request, options)
    },

    async previewPanel(panelId, tempPanel, options = {}) {
      const { variablesOverride = {}, signal } = options
      const parsed = PanelConfigSchema.parse(tempPanel)
      const activeRequests = parsed.dataRequests.filter((r) => !r.hide)

      if (activeRequests.length === 0) return { data: null as unknown, rawData: [] }

      const rawData = await Promise.all(
        activeRequests.map((req) =>
          engine.executeDataRequest(req, {
            panelId,
            variablesOverride,
            ...(signal !== undefined ? { signal } : {}),
          }),
        ),
      )

      const pipelined = engine.applyPanelTransforms(parsed.type, rawData)
      const panelDef = engine.getPanelPlugin(parsed.type)
      const data = panelDef?.transform ? panelDef.transform(pipelined) : pipelined
      return { data, rawData }
    },
  }
}
