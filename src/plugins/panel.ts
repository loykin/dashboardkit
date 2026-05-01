import type {
  PanelConfig,
  PanelPatchInput,
  QueryResult,
} from '../schema'
import type { OptionSchema } from '../schema'

export type PluginComponent<Props> = (props: Props) => unknown

export interface PanelTransformContext {
  panel: PanelConfig
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
}

export interface PanelProps<TOptions, TData> {
  options: TOptions
  data: TData
  rawData: QueryResult[] | null
  width: number
  height: number
  loading: boolean
  error: string | null
}

export interface PanelViewerProps<TOptions, TData> extends PanelProps<TOptions, TData> {
  panel: PanelConfig
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
}

export interface PanelEditorProps<TOptions> {
  panel: PanelConfig
  options: TOptions
  onOptionsChange(options: TOptions): void
  onPanelChange(patch: PanelPatchInput): void
  preview(): Promise<void>
}

export interface PanelPluginCapabilities {
  supportsFieldConfig?: boolean
  supportsLinks?: boolean
  supportsTransparent?: boolean
  supportsRepeat?: boolean
}

// Filter dimensions this panel can emit via cross-filter selection
export interface PanelSelectionDef {
  variableName: string
  label?: string
}

export interface PanelPluginDef<TOptions = Record<string, unknown>, TData = unknown> {
  id: string
  name: string
  description?: string
  optionsSchema: OptionSchema
  defaultOptions?: TOptions
  transform?: (results: QueryResult[], ctx?: PanelTransformContext) => TData
  viewer?: PluginComponent<PanelViewerProps<TOptions, TData>>
  editor?: PluginComponent<PanelEditorProps<TOptions>>
  capabilities?: PanelPluginCapabilities
  // Cross-filter: declares which variable dimensions this panel can emit as selections
  selections?: PanelSelectionDef[]
}
