import type { OptionSchema, ValidateOptionSchemaOptions, ValidationResult } from './options'
import type { DashboardDatasourceAdapter } from '../datasources'
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

export type { DashboardDatasourceAdapter, DashboardDatasourceContext } from '../datasources'
export type { PanelPluginDef, PanelProps } from '../plugins/panel'
export type { ValidateOptionSchemaOptions, ValidationResult, ValidationError } from './options'
export type { TransformPluginDef } from '../transforms'

// ─── Panel Plugin ───────────────────────────────────────────────────────────────

export function definePanel<TOptions = Record<string, unknown>, TData = unknown>(
  def: PanelPluginDef<TOptions, TData>,
): PanelPluginDef<TOptions, TData> {
  return def
}

// ─── VariableType Plugin ────────────────────────────────────────────────────────

export interface VariableResolveContext {
  builtins: Record<string, string>
  variables: Record<string, string | string[]>
  dashboard: { id: string; title: string }
  authContext?: AuthContext
  queryVariableOptions?: (request: import('./types').DataRequestConfig) => Promise<VariableOption[]>
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
  datasourceAdapter?: DashboardDatasourceAdapter
  variableTypes?: ReadonlyArray<VariableTypePluginDef>
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
      timeRange?: { from: string; to: string }
      authContext?: AuthContext
      builtins?: Record<string, string>
      signal?: AbortSignal
    },
  ): Promise<QueryResult>
  listDatasourceNamespaces(
    datasourceUid: string,
    options?: {
      variablesOverride?: Record<string, string | string[]>
      timeRange?: { from: string; to: string }
      authContext?: AuthContext
      builtins?: Record<string, string>
    },
  ): Promise<import('../datasources').DatasourceSchemaNamespace[]>
  listDatasourceFields(
    datasourceUid: string,
    request: import('../datasources').DatasourceSchemaFieldRequest,
    options?: {
      variablesOverride?: Record<string, string | string[]>
      timeRange?: { from: string; to: string }
      authContext?: AuthContext
      builtins?: Record<string, string>
    },
  ): Promise<import('../datasources').DatasourceSchemaField[]>
  healthCheckDatasource(
    datasourceUid: string,
    options?: { authContext?: AuthContext },
  ): Promise<import('../datasources').DatasourceHealthResult>
  validateDatasourceQuery(
    datasourceUid: string,
    query: unknown,
    options?: {
      variablesOverride?: Record<string, string | string[]>
      timeRange?: { from: string; to: string }
      authContext?: AuthContext
      builtins?: Record<string, string>
    },
  ): Promise<import('../datasources').DatasourceValidationResult>
  applyPanelTransforms(type: string, results: QueryResult[]): QueryResult[]
  getPanelPlugin(type: string): PanelPluginDef | undefined
  invalidateCache(panelIds?: string[]): void
  queryAnnotations(timeRange?: { from: string; to: string }): Promise<Annotation[]>

  // Subscribe (returns unsubscribe function)
  subscribe(listener: (event: import('./types').EngineEvent) => void): () => void

  // Abort all in-flight panel requests without tearing down the engine.
  // Call this when the dashboard view unmounts but the engine instance is reused.
  abortAll(): void

  // Abort all in-flight panel requests and unsubscribe from the state store.
  // Call this when the engine instance itself is no longer needed.
  destroy(): void

  // Runtime registration — add plugins after engine creation
  registerPanel(def: PanelPluginDef): void
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
