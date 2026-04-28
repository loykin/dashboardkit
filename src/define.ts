import type { VariableOption } from './types'
import type { QueryOptions, QueryResult } from './types'
import type { BuiltinContext, BuiltinVariable } from './builtins'
import type { OptionSchema } from './options'
import type {
  AuthContext,
  AuthorizationDecision,
  AuthorizationRequest,
  DashboardStateStore,
} from './types'

// ─── Datasource Plugin ───────────────────────────────────────────────────────────────
// uid: 1:1 mapping with target.datasource.uid in the dashboard JSON
// options: infrastructure config for this instance (URL, auth, etc.) — differs per environment
export interface DatasourcePluginDef<TOptions = Record<string, unknown>> {
  uid: string
  options?: TOptions

  query: (options: QueryOptions<TOptions>) => Promise<QueryResult>
  metricFindQuery?: (
    query: string,
    vars: Record<string, string | string[]>,
  ) => Promise<VariableOption[]>
}

export function defineDatasource<TOptions = Record<string, unknown>>(
  def: DatasourcePluginDef<TOptions>,
): DatasourcePluginDef<TOptions> {
  return def
}

// ─── Panel Plugin ───────────────────────────────────────────────────────────────

export interface PanelProps<TOptions, TData> {
  options: TOptions
  data: TData
  rawData: QueryResult | null
  width: number
  height: number
  loading: boolean
  error: string | null
}

export interface PanelPluginDef<TOptions = Record<string, unknown>, TData = unknown> {
  id: string
  name: string
  optionsSchema: OptionSchema

  // Transforms QueryResult into the shape consumed by the panel (defaults to QueryResult as-is)
  transform?: (result: QueryResult) => TData
  // headless: no styles. Users apply their own styling.
  component: React.ComponentType<PanelProps<TOptions, TData>>
}

export function definePanel<TOptions = Record<string, unknown>, TData = unknown>(
  def: PanelPluginDef<TOptions, TData>,
): PanelPluginDef<TOptions, TData> {
  return def
}

// ─── VariableType Plugin ────────────────────────────────────────────────────────

export interface VariableResolveContext {
  datasources: Record<string, DatasourcePluginDef>
  builtins: Record<string, string>
  variables: Record<string, string | string[]>
  dashboard: { id: string; title: string }
  authContext?: AuthContext
}

export interface VariableTypePluginDef<TOptions = Record<string, unknown>> {
  id: string
  name: string
  optionsSchema: OptionSchema

  resolve: (
    config: import('./types').VariableConfig,
    options: TOptions,
    ctx: VariableResolveContext,
  ) => Promise<VariableOption[]>
}

export function defineVariableType<TOptions = Record<string, unknown>>(
  def: VariableTypePluginDef<TOptions>,
): VariableTypePluginDef<TOptions> {
  return def
}

// ─── Engine Creation Options ────────────────────────────────────────────────────

export interface CreateDashboardEngineOptions {
  panels: PanelPluginDef[]
  datasources: DatasourcePluginDef[]
  variableTypes: VariableTypePluginDef[]
  builtinVariables?: BuiltinVariable[]
  stateStore?: DashboardStateStore
  authContext?: AuthContext
  authorize?: (
    request: AuthorizationRequest,
  ) => boolean | AuthorizationDecision | Promise<boolean | AuthorizationDecision>
}

// ─── CoreEngineAPI ─────────────────────────────────────────────────────────────

export interface CoreEngineAPI {
  // Load config (accepts input type — defaults are filled in automatically)
  load(config: import('./types').DashboardInput): void
  getConfig(): import('./types').DashboardConfig | null

  // Variables
  getVariable(name: string): import('./types').VariableState | undefined
  setVariable(name: string, value: string | string[]): void
  refreshVariables(): Promise<void>

  // Panels
  getPanel(panelId: string): import('./types').PanelState | undefined
  refreshPanel(panelId: string): Promise<void>
  refreshAll(): Promise<void>

  // Time range
  setTimeRange(range: { from: string; to: string }): void
  getTimeRange(): { from: string; to: string } | undefined
  setRefresh(refresh: string): void
  getRefresh(): string | undefined

  // Authorization context
  setAuthContext(context: AuthContext): void
  getAuthContext(): AuthContext

  // Subscribe (returns unsubscribe function)
  subscribe(listener: (event: import('./types').EngineEvent) => void): () => void
}

// createDashboardEngine is implemented and exported from engine.ts.
// Only types/interfaces are defined here.

// ─── Addon Pattern ──────────────────────────────────────────────────────────────
// An addon receives a CoreEngineAPI and adds functionality via side effects.
// Example: addon-time-range → wraps engine.setTimeRange() + parses relative time
// Example: addon-refresh   → polling timer + engine.refreshAll() call

export interface AddonFactory<TAddonAPI = void> {
  (engine: CoreEngineAPI): TAddonAPI
}

export function createBuiltinContext(
  timeRange: { from: string; to: string },
  dashboardId: string,
  dashboardTitle: string,
): BuiltinContext {
  return { timeRange, dashboard: { id: dashboardId, title: dashboardTitle } }
}
