import type {
  PanelConfig,
  PanelPatchInput,
  QueryResult,
} from '../schema'
import type { OptionSchema } from '../schema'
import type { PanelTransformConfig } from '../transforms'

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
  /**
   * Declarative transform pipeline applied to raw QueryResult[] before transform() is called.
   * Each step is a pure function; steps run in order.
   */
  transforms?: PanelTransformConfig[]
  transform?: (results: QueryResult[], ctx?: PanelTransformContext) => TData
  // Method shorthand makes viewer/editor bivariant in their Props parameter,
  // which allows PanelPluginDef<Opts, SpecificData> to be assigned to
  // PanelPluginDef<Opts, unknown> without 'as any' casts.
  // The engine never calls viewer/editor itself — only the renderer does,
  // with the correctly-typed data produced by transform().
  viewer?(props: PanelViewerProps<TOptions, TData>): unknown
  editor?(props: PanelEditorProps<TOptions>): unknown
  capabilities?: PanelPluginCapabilities
  // Cross-filter: declares which variable dimensions this panel can emit as selections
  selections?: PanelSelectionDef[]
}
