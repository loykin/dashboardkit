import { z } from 'zod'

// ─── Variable Name Validation ────────────────────────────────────────────────
const VariableNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    'Variable name must start with a letter or underscore, no dots allowed',
  )
  .refine((name) => !name.startsWith('__'), '$__ prefix is reserved for built-in variables')

// ─── Permissions ─────────────────────────────────────────────────────────────
// Headless authorization metadata. The engine can enforce these rules through
// createDashboardEngine({ authContext, authorize }) before datasource queries.
export const PermissionRuleSchema = z.object({
  action: z.string().min(1),
  effect: z.enum(['allow', 'deny']).default('allow'),
  roles: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  subjects: z.array(z.string()).optional(),
  reason: z.string().optional(),
  condition: z.record(z.unknown()).optional(),
})

const QueryDescriptorSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.record(z.unknown()),
])

// ─── Data Request ─────────────────────────────────────────────────────────────
// A panel or variable can request data from one or more datasource plugins. Each
// request keeps the plugin identity, query descriptor, and request-local options together.
export const DataRequestSchema = z
  .object({
    id: z.string().min(1).default('main'),
    uid: z.string().min(1),
    type: z.string().min(1),
    query: QueryDescriptorSchema.optional(),
    options: z.record(z.unknown()).default({}),
    hide: z.boolean().default(false),
    permissions: z.array(PermissionRuleSchema).default([]),
  })
  .passthrough()

// ─── Variable Config ──────────────────────────────────────────────────────────
export const VariableConfigSchema = z.object({
  name: VariableNameSchema,
  type: z.string().min(1),
  label: z.string().optional(),
  dataRequest: DataRequestSchema.optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).nullable().default(null),
  multi: z.boolean().default(false),
  includeAll: z.boolean().default(false),
  allValue: z.string().optional(),
  hide: z.enum(['none', 'label', 'variable']).default('none'),
  sort: z.enum(['none', 'alphaAsc', 'alphaDesc', 'numericAsc', 'numericDesc']).default('none'),
  permissions: z.array(PermissionRuleSchema).default([]),
  options: z.record(z.unknown()).default({}),
})

// ─── Grid Position ───────────────────────────────────────────────────────────
// Embedded in each panel; no separate cells map at dashboard level.
export const GridPosSchema = z.object({
  x: z.number().int().min(0),            // column start (0-based)
  y: z.number().int().min(0),            // row start (0-based)
  w: z.number().int().min(1).max(24),    // width (in columns)
  h: z.number().int().min(1),            // height (in rowHeight units)
})

// ─── Field Display Config ────────────────────────────────────────────────────
// [Extension Point #2 — Panel Plugin / Common]
// defaults / overrides are visualization metadata interpreted by the panel plugin.
// The library only defines the structure; actual rendering is the panel component's responsibility.
export const ThresholdStepSchema = z.object({
  value: z.number().nullable(),  // null = base (lowest threshold)
  color: z.string(),             // CSS color or semantic palette name
})

export const FieldConfigSchema = z.object({
  unit: z.string().optional(),            // "short" | "bytes" | "percent" | "ms" | ...
  decimals: z.number().int().min(0).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  displayName: z.string().optional(),     // override name shown in legend/tooltip
  noValue: z.string().optional(),         // string to display when value is null
  thresholds: z.object({
    mode: z.enum(['absolute', 'percentage']).default('absolute'),
    steps: z.array(ThresholdStepSchema).default([]),
  }).optional(),
  color: z.object({
    mode: z.enum(['fixed', 'thresholds', 'palette-classic']).default('thresholds'),
    fixedColor: z.string().optional(),
  }).optional(),
  // per-field overrides (set unit/color for a specific series)
  overrides: z.array(z.object({
    matcher: z.object({ id: z.string(), options: z.unknown().optional() }),
    properties: z.array(z.object({ id: z.string(), value: z.unknown() })),
  })).default([]),
})

// ─── Panel Link (drill-down URL) ────────────────────────────────────────────────
export const PanelLinkSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),                // supports $varName interpolation
  targetBlank: z.boolean().default(true),
  tooltip: z.string().optional(),
})

// ─── Panel Config ────────────────────────────────────────────────────────────────
// gridPos is embedded in the panel — all panel declarations are self-contained in dashboard JSON
export const PanelConfigSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().default(''),          // supports $varName references
  description: z.string().default(''),

  // ── Position / Size ──
  gridPos: GridPosSchema,

  // ── Data ──
  dataRequests: z.array(DataRequestSchema).default([]),

  // ── Display ──
  fieldConfig: FieldConfigSchema.optional(),

  // ── Repeat ──
  // repeat: variable name. Clones one panel per value of that variable.
  repeat: VariableNameSchema.optional(),
  repeatDirection: z.enum(['h', 'v']).default('h'),

  // ── Misc ──
  transparent: z.boolean().default(false),
  links: z.array(PanelLinkSchema).default([]),
  permissions: z.array(PermissionRuleSchema).default([]),
  options: z.record(z.unknown()).default({}),   // panel plugin-specific options
})

// ─── Refresh Interval ───────────────────────────────────────────────────────────
const RefreshSchema = z.union([
  z.literal(''),         // auto-refresh disabled
  z.literal('5s'),
  z.literal('10s'),
  z.literal('30s'),
  z.literal('1m'),
  z.literal('5m'),
  z.literal('15m'),
  z.literal('30m'),
  z.literal('1h'),
])

// ─── Dashboard Config ───────────────────────────────────────────────────────────
export const DashboardConfigSchema = z.object({
  schemaVersion: z.literal(1),           // increment as integer when bumping schema version
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),

  // dashboard variables
  variables: z.array(VariableConfigSchema).default([]),

  // panel list; gridPos included
  panels: z.array(PanelConfigSchema).refine(
    (panels) => panels.every((panel) => {
      const ids = panel.dataRequests.map((request) => request.id)
      return ids.length === new Set(ids).size
    }),
    'panel data request ids must be unique within each panel',
  ),

  // global grid config (per-panel position is in panel.gridPos)
  layout: z.object({
    cols: z.number().int().min(1).default(24),
    rowHeight: z.number().int().min(1).default(30),
  }).default({ cols: 24, rowHeight: 30 }),

  // dashboard time range
  timeRange: z.object({
    from: z.string().default('now-6h'),  // ISO 8601 or relative expression
    to: z.string().default('now'),
  }).default({ from: 'now-6h', to: 'now' }),

  // auto-refresh interval
  refresh: RefreshSchema.default(''),

  // dashboard-level links (top navigation, etc.)
  links: z.array(PanelLinkSchema).default([]),

  // dashboard-level permission defaults
  permissions: z.array(PermissionRuleSchema).default([]),
})

// ─── Inferred TypeScript Types ────────────────────────────────────────────────
export type VariableConfig = z.infer<typeof VariableConfigSchema>
export type PermissionRule = z.infer<typeof PermissionRuleSchema>
export type GridPos = z.infer<typeof GridPosSchema>
export type DataRequestConfig = z.output<typeof DataRequestSchema>
export type DataRequestInput = z.input<typeof DataRequestSchema>
export type FieldConfig = z.infer<typeof FieldConfigSchema>
export type ThresholdStep = z.infer<typeof ThresholdStepSchema>
export type PanelLink = z.infer<typeof PanelLinkSchema>
export type PanelConfig = z.output<typeof PanelConfigSchema>
type PanelSchemaInput = z.input<typeof PanelConfigSchema>
// Input type (before parsing): fields with defaults are optional — use when constructing panel literals.
// Keep nested dataRequests explicitly input-shaped so editor-facing APIs do not require zod defaults.
export type PanelInput = Omit<PanelSchemaInput, 'dataRequests'> & {
  dataRequests?: DataRequestInput[]
}
export type PanelPatchInput = Omit<Partial<PanelInput>, 'dataRequests'> & {
  dataRequests?: DataRequestInput[]
}
// Output type (after parsing): all defaults filled in — used internally by the engine
export type DashboardConfig = z.output<typeof DashboardConfigSchema>
type DashboardSchemaInput = z.input<typeof DashboardConfigSchema>
// Input type (before parsing): use this when writing a config literal.
export type DashboardInput = Omit<DashboardSchemaInput, 'panels'> & {
  panels: PanelInput[]
}

export interface DashboardStateSnapshot {
  variables: Record<string, string | string[]>
  timeRange?: { from: string; to: string }
  refresh?: string
}

// Canonical dashboard input state. Adapters may be backed by URL query params,
// router state, or another app-owned store. The engine must only read/write the
// keys it owns and must preserve unknown app/query state.
export interface DashboardStatePatch {
  variables?: Record<string, string | string[] | undefined>
  timeRange?: { from: string; to: string }
  refresh?: string
}

export interface DashboardStateWriteOptions {
  replace?: boolean
}

export interface DashboardStateStore {
  getSnapshot(): DashboardStateSnapshot
  setPatch(patch: DashboardStatePatch, options?: DashboardStateWriteOptions): void
  subscribe(listener: (snapshot: DashboardStateSnapshot) => void): () => void
}

export type DashboardLoadStatePolicy = 'preserve' | 'replace-dashboard-variables'

export interface DashboardLoadOptions {
  statePolicy?: DashboardLoadStatePolicy
  state?: DashboardStateSnapshot
}

export type PermissionEffect = 'allow' | 'deny'
export type PermissionAction =
  | 'dashboard:view'
  | 'dashboard:edit'
  | 'panel:view'
  | 'panel:query'
  | 'panel:edit'
  | 'variable:view'
  | 'variable:set'
  | 'variable:query'
  | 'datasource:query'
  | (string & {})

export interface AuthSubject {
  id: string
  roles?: string[]
  groups?: string[]
  attributes?: Record<string, unknown>
}

export interface AuthContext {
  subject?: AuthSubject
  tenantId?: string
  attributes?: Record<string, unknown>
}

export interface AuthorizationDecision {
  allowed: boolean
  reason?: string
}

export interface AuthorizationRequest {
  action: PermissionAction
  authContext: AuthContext
  dashboard: DashboardConfig
  panel?: PanelConfig
  dataRequest?: DataRequestConfig
  variable?: VariableConfig
  datasourceUid?: string
  permissions: PermissionRule[]
}

// ─── Query Execution Options ─────────────────────────────────────────────────
// [Library / Plugin boundary]
//
// Provided by the library: dashboardId, panelId, requestId, variables, timeRange
// Owned by the app/plugin/backend: query and datasource.options semantics.
export interface QueryOptions<TOptions = Record<string, unknown>> {
  /** Full panel or variable data request object */
  dataRequest: DataRequestConfig
  dashboardId: string
  panelId: string
  requestId: string
  query?: string | string[] | Record<string, unknown>
  requestOptions: Record<string, unknown>
  variables: Record<string, string | string[]>
  datasourceOptions: TOptions
  authContext?: AuthContext
  timeRange?: { from: string; to: string }
  maxDataPoints?: number
  /** AbortSignal — cancelled when a newer request supersedes this one */
  signal?: AbortSignal
  builtins?: Record<string, string>
  panel?: PanelConfig
  panelOptions?: Record<string, unknown>
  panelInstance?: PanelRuntimeInstance
}

// ─── Query Response ─────────────────────────────────────────────────────────────
export interface QueryResult {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
  requestId?: string
  meta?: Record<string, unknown>
}


// ─── Variable Dropdown Option ────────────────────────────────────────────────
export interface VariableOption {
  label: string
  value: string
}

// ─── Runtime Variable State (Zustand store) ──────────────────────────────────
export type VariableRuntimeStatus = 'idle' | 'loading' | 'success' | 'error'

export interface VariableReadiness {
  ready: boolean
  waiting: string[]
  errors: Record<string, string>
}

export interface VariableState {
  name: string
  type: string
  value: string | string[]
  options: VariableOption[]
  loading: boolean
  error: string | null
  status: VariableRuntimeStatus
}

// ─── Runtime Panel State (Zustand store) ─────────────────────────────────────
export interface PanelState {
  id: string
  data: unknown // result of definePanel.transform()
  rawData: QueryResult[] | null
  loading: boolean
  error: string | null
  width: number
  height: number
  active: boolean // whether the panel is in the viewport
}

// ─── Runtime Panel Instances ─────────────────────────────────────────────────
// A dashboard stores PanelConfig entries, but the engine executes runtime
// instances. Repeat and future expansion layers can turn one config into
// multiple instances without mutating the saved dashboard JSON.
export interface PanelRuntimeInstance {
  id: string
  originId: string
  config: PanelConfig
  type: string
  title: string
  gridPos: GridPos
  variablesOverride?: Record<string, string | string[]>
  repeat?: {
    varName: string
    value: string
    index: number
    direction: 'h' | 'v'
  }
  meta?: Record<string, unknown>
}

export interface PanelExpansionContext {
  dashboard: DashboardConfig
  variables: Record<string, string | string[]>
}

export interface PanelExpander {
  id: string
  expand(
    instances: readonly PanelRuntimeInstance[],
    ctx: PanelExpansionContext,
  ): PanelRuntimeInstance[]
}

export interface PanelDependencyInfo {
  directVariables: string[]
  requiredVariables: string[]
}

export interface PanelReadiness {
  ready: boolean
  waitingVariables: string[]
  variableErrors: Record<string, string>
}

// ─── Engine Events ────────────────────────────────────────────────────────────
export type EngineEvent =
  | { type: 'variable-changed'; name: string; value: string | string[] }
  | { type: 'panel-loading'; panelId: string }
  | { type: 'panel-data'; panelId: string; data: unknown }
  | { type: 'panel-error'; panelId: string; error: string }
  | { type: 'authorization-denied'; action: PermissionAction; resourceId: string; reason: string }
  | { type: 'time-range-changed'; range: { from: string; to: string } }
  | { type: 'refresh-changed'; refresh: string }
