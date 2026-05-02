import type { OptionSchema, ValidateOptionSchemaOptions, ValidationResult } from './options'
import type { DatasourcePluginDef } from '../plugins'
import type { PanelPluginDef } from '../plugins'
import type {
  Annotation,
  AuthContext,
  AuthorizationDecision,
  AuthorizationRequest,
  DashboardLoadOptions,
  DashboardPatchInput,
  DashboardStateStore,
  DataRequestInput,
  PanelConfig,
  PanelInput,
  PanelPatchInput,
  PanelDependencyInfo,
  PanelExpander,
  PanelRuntimeInstance,
  PanelReadiness,
  QueryResult,
  VariableConfig,
  VariableInput,
  VariablePatchInput,
  VariableReadiness,
  VariableOption,
} from './types'

export type { DatasourcePluginDef } from '../plugins/datasource'
export type { PanelPluginDef, PanelProps } from '../plugins/panel'
export type { ValidateOptionSchemaOptions, ValidationResult, ValidationError } from './options'
export type { TransformPluginDef } from '../transforms'

// ─── Datasource Plugin ───────────────────────────────────────────────────────────────
// uid: 1:1 mapping with dataRequest.uid in the dashboard JSON
// options: infrastructure config for this instance (URL, auth, etc.) — differs per environment
export function defineDatasource<
  TOptions = Record<string, unknown>,
  TQuery = unknown,
>(
  def: DatasourcePluginDef<TOptions, TQuery>,
): DatasourcePluginDef<TOptions, TQuery> {
  return def
}

// ─── Panel Plugin ───────────────────────────────────────────────────────────────

export function definePanel<TOptions = Record<string, unknown>, TData = unknown>(
  def: PanelPluginDef<TOptions, TData>,
): PanelPluginDef<TOptions, TData> {
  return def
}

// ─── VariableType Plugin ────────────────────────────────────────────────────────

export interface VariableResolveContext {
  datasourcePlugins: Record<string, DatasourcePluginDef>
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
  panels?: PanelPluginDef[]
  datasourcePlugins?: DatasourcePluginDef[]
  variableTypes?: VariableTypePluginDef[]
  panelExpanders?: PanelExpander[]
  stateStore?: DashboardStateStore
  authContext?: AuthContext
  authorize?: (
    request: AuthorizationRequest,
  ) => boolean | AuthorizationDecision | Promise<boolean | AuthorizationDecision>
}

// ─── CoreEngineAPI ─────────────────────────────────────────────────────────────

export interface CoreEngineAPI {
  // Load config (accepts input type — defaults are filled in automatically)
  load(config: import('./types').DashboardInput, options?: DashboardLoadOptions): void
  getConfig(): import('./types').DashboardConfig | null

  // Variables
  getVariable(name: string): import('./types').VariableState | undefined
  registerVariable(def: VariableInput, options?: { refresh?: boolean }): Promise<void>
  addVariable(
    variable: VariableInput,
    options?: { refresh?: boolean },
  ): Promise<void>
  updateVariable(
    name: string,
    patch: VariablePatchInput | ((current: VariableConfig) => VariableInput),
    options?: { refresh?: boolean },
  ): Promise<void>
  removeVariable(
    name: string,
    options?: { refresh?: boolean },
  ): Promise<void>
  setVariable(name: string, value: string | string[]): void
  refreshVariables(): Promise<void>
  refreshVariable(name: string): Promise<boolean>
  getVariableReadiness(names: readonly string[]): VariableReadiness

  // Panels
  getPanel(panelId: string): import('./types').PanelState | undefined
  getPanelInstances(): PanelRuntimeInstance[]
  getPanelInstance(instanceId: string): PanelRuntimeInstance | undefined
  getPanelDependencies(panelId: string): PanelDependencyInfo | null
  getPanelReadiness(panelId: string): PanelReadiness | null
  refreshPanel(panelId: string): Promise<void>
  refreshAll(): Promise<void>
  addPanel(
    panel: PanelInput,
    options?: { refresh?: boolean },
  ): Promise<void>
  updatePanel(
    panelId: string,
    patch: PanelPatchInput | ((current: PanelConfig) => PanelInput),
    options?: { refresh?: boolean; invalidateCache?: boolean },
  ): Promise<void>
  removePanel(
    panelId: string,
    options?: { refresh?: boolean; invalidateCache?: boolean },
  ): Promise<void>
  validatePanelOptions(type: string, options: unknown, validationOptions?: ValidateOptionSchemaOptions): ValidationResult
  validateDataRequest(request: DataRequestInput): ValidationResult

  // Time range — read-only convenience; write via setVariable with a datetime/refresh variable
  getTimeRange(): { from: string; to: string } | undefined
  getRefresh(): string | undefined

  // Dashboard config
  updateDashboard(
    patch: DashboardPatchInput,
    options?: { refresh?: boolean },
  ): Promise<void>

  // Authorization context
  setAuthContext(context: AuthContext): void
  getAuthContext(): AuthContext

  // Kernel primitives — building blocks for addon authoring
  setPanelQueryScope(panelId: string, scope: Record<string, string | string[]> | null): void
  getPanelQueryScopes(): Record<string, Record<string, string | string[]>>
  executeDataRequest(
    request: DataRequestInput,
    options?: {
      panelId?: string
      variablesOverride?: Record<string, string | string[]>
      signal?: AbortSignal
    },
  ): Promise<QueryResult>
  applyPanelTransforms(type: string, results: QueryResult[]): QueryResult[]
  getPanelPlugin(type: string): PanelPluginDef | undefined
  invalidateCache(panelIds?: string[]): void
  queryAnnotations(timeRange?: { from: string; to: string }): Promise<Annotation[]>

  // Subscribe (returns unsubscribe function)
  subscribe(listener: (event: import('./types').EngineEvent) => void): () => void

  // Runtime registration — add plugins after engine creation
  registerPanel(def: PanelPluginDef): void
  registerDatasource(def: DatasourcePluginDef): void
  registerVariableType(def: VariableTypePluginDef): void
  registerTransform(def: import('../transforms').TransformPluginDef): void
}

// createDashboardEngine is implemented and exported from engine.ts.
// Only types/interfaces are defined here.

// ─── Addon Pattern ──────────────────────────────────────────────────────────────
// An addon receives a CoreEngineAPI and adds functionality via side effects.
// Example: addon-cross-filter → uses setPanelQueryScope + invalidateCache + refreshAll
// Example: addon-auto-refresh → wraps engine.getRefresh() + engine.refreshAll()

export interface AddonFactory<TAddonAPI = void> {
  (engine: CoreEngineAPI): TAddonAPI
}

export function createBuiltinContext(
  timeRange: { from: string; to: string },
  dashboardId: string,
  dashboardTitle: string,
): import('../variables').BuiltinContext {
  return { timeRange, dashboard: { id: dashboardId, title: dashboardTitle } }
}
