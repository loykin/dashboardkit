import { z } from 'zod'

// ─── Variable Name Validation ────────────────────────────────────────────────
const VariableNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    'Variable name must start with a letter or underscore, no dots allowed',
  )
  .refine((name) => !name.startsWith('__'), '$__ prefix is reserved for built-in variables')

// ─── Datasource Reference ────────────────────────────────────────────────────
export const DataSourceRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  options: z.record(z.unknown()).default({}),
})

// ─── Variable Config ──────────────────────────────────────────────────────────
export const VariableConfigSchema = z.object({
  name: VariableNameSchema,
  type: z.string().min(1),
  label: z.string().optional(),
  datasourceId: z.string().optional(),
  query: z.string().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).nullable().default(null),
  multi: z.boolean().default(false),
  options: z.record(z.unknown()).default({}),
})

// ─── Grid Position (same as Grafana gridPos) ───────────────────────────────────
// Embedded in each panel — no separate cells map at dashboard level
export const GridPosSchema = z.object({
  x: z.number().int().min(0),            // column start (0-based)
  y: z.number().int().min(0),            // row start (0-based)
  w: z.number().int().min(1).max(24),    // width (in columns)
  h: z.number().int().min(1),            // height (in rowHeight units)
})

// ─── Query Target ─────────────────────────────────────────────────────────────
// [Extension Point #1 — Datasource Plugin]
//
// Only refId / datasource / hide are defined by the library.
// All other fields are freely defined by the datasource plugin.
//
//   Prometheus:  { expr: "rate(...)", legendFormat: "{{method}}", interval: "1m" }
//   ClickHouse:  { rawSql: "SELECT ...", format: "time_series" }
//   Loki:        { expr: "{app=\"api\"}", queryType: "range" }
//
// TypeScript type safety is handled by the defineDatasource<TOptions, TQuery>() generic.
// Zod validates only the common fields; the rest are passthrough.
export const TargetSchema = z
  .object({
    refId: z.string().min(1).default('A'),
    // datasource reference — inherits panel.datasource or can be overridden per target
    datasource: z.object({
      uid: z.string().min(1),   // maps to datasources[].id
      type: z.string().min(1),  // id of the defineDatasource definition
    }).optional(),
    hide: z.boolean().default(false),
  })
  .passthrough()  // allows datasource plugin-specific fields (expr, rawSql, queryType, etc.)

// ─── Field Display Config (maps to Grafana fieldConfig) ─────────────────────────
// [Extension Point #2 — Panel Plugin / Common]
// defaults / overrides are visualization metadata interpreted by the panel plugin.
// The library only defines the structure; actual rendering is the panel component's responsibility.
export const ThresholdStepSchema = z.object({
  value: z.number().nullable(),  // null = base (lowest threshold)
  color: z.string(),             // CSS color or Grafana palette name ("green", "red", …)
})

export const FieldConfigSchema = z.object({
  unit: z.string().optional(),            // "short" | "bytes" | "percent" | "ms" | …
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
  // datasource: panel-level default datasource — used when targets[].datasource is not set
  // Same role as panel.datasource in Grafana
  datasource: z.object({
    uid: z.string().min(1),  // maps to datasources[].id
    type: z.string().min(1), // id of the defineDatasource definition
  }).optional(),

  // targets[]: multiple queries per panel — useful for comparison graphs, calculated fields, etc.
  // Distinguished by refId (A/B/C…) same as Grafana
  targets: z.array(TargetSchema).default([]),

  // ── Display ──
  fieldConfig: FieldConfigSchema.optional(),

  // ── Repeat ──
  // repeat: variable name. Clones one panel per value of that variable (Grafana repeat panel)
  repeat: VariableNameSchema.optional(),
  repeatDirection: z.enum(['h', 'v']).default('h'),

  // ── Misc ──
  transparent: z.boolean().default(false),
  links: z.array(PanelLinkSchema).default([]),
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
// Reference: Grafana dashboard JSON model
//   schemaVersion, id, title, panels[], time, refresh, tags, variables, links
export const DashboardConfigSchema = z.object({
  schemaVersion: z.literal(1),           // increment as integer when bumping schema version
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),

  // variables (= Grafana template variables)
  variables: z.array(VariableConfigSchema).default([]),

  // panel list — gridPos included (Grafana style, no cells map)
  panels: z.array(PanelConfigSchema),

  // global grid config (per-panel position is in panel.gridPos)
  layout: z.object({
    cols: z.number().int().min(1).default(24),      // Grafana default: 24
    rowHeight: z.number().int().min(1).default(30), // Grafana default: 30px
  }).default({ cols: 24, rowHeight: 30 }),

  // time range (= Grafana time)
  timeRange: z.object({
    from: z.string().default('now-6h'),  // ISO 8601 or relative expression
    to: z.string().default('now'),
  }).default({ from: 'now-6h', to: 'now' }),

  // auto-refresh interval
  refresh: RefreshSchema.default(''),

  // dashboard-level links (top navigation, etc.)
  links: z.array(PanelLinkSchema).default([]),
})

// ─── Inferred TypeScript Types ────────────────────────────────────────────────
export type VariableConfig = z.infer<typeof VariableConfigSchema>
export type GridPos = z.infer<typeof GridPosSchema>
export type Target = z.infer<typeof TargetSchema>
export type FieldConfig = z.infer<typeof FieldConfigSchema>
export type ThresholdStep = z.infer<typeof ThresholdStepSchema>
export type PanelLink = z.infer<typeof PanelLinkSchema>
export type PanelConfig = z.infer<typeof PanelConfigSchema>
// Output type (after parsing): all defaults filled in — used internally by the engine
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>
// Input type (before parsing): fields with defaults are optional — use this when writing a config literal
export type DashboardInput = z.input<typeof DashboardConfigSchema>

// ─── Query Execution Options ─────────────────────────────────────────────────
// [Library / Plugin boundary]
//
// Provided by the library: refId, variables, timeRange, maxDataPoints
// Owned by the plugin: target (including plugin-specific fields)
//
// The plugin extracts its own fields from target:
//   Prometheus:  const { expr, legendFormat } = target as PrometheusTarget
//   ClickHouse:  const { rawSql } = target as ClickHouseTarget
//
// Interpolation ($varName substitution) is also the plugin's responsibility.
// The library only passes variables; it does not need to know the query string.
export interface QueryOptions<TOptions = Record<string, unknown>> {
  /** Full target object — plugin extracts its own fields from here */
  target: Record<string, unknown>
  refId: string
  variables: Record<string, string | string[]>
  datasourceOptions: TOptions
  timeRange?: { from: string; to: string }
  maxDataPoints?: number
}

// ─── Query Response ─────────────────────────────────────────────────────────────
export interface QueryResult {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
  refId?: string                         // identifies which target this response belongs to
  meta?: Record<string, unknown>
}


// ─── Variable Dropdown Option ────────────────────────────────────────────────
export interface VariableOption {
  label: string
  value: string
}

// ─── Runtime Variable State (Zustand store) ──────────────────────────────────
export interface VariableState {
  name: string
  type: string
  value: string | string[]
  options: VariableOption[]
  loading: boolean
  error: string | null
}

// ─── Runtime Panel State (Zustand store) ─────────────────────────────────────
export interface PanelState {
  id: string
  data: unknown // result of definePanel.transform()
  rawData: QueryResult | null
  loading: boolean
  error: string | null
  width: number
  height: number
  active: boolean // whether the panel is in the viewport
}

// ─── Engine Events ────────────────────────────────────────────────────────────
export type EngineEvent =
  | { type: 'variable-changed'; name: string; value: string | string[] }
  | { type: 'panel-loading'; panelId: string }
  | { type: 'panel-data'; panelId: string; data: unknown }
  | { type: 'panel-error'; panelId: string; error: string }
  | { type: 'time-range-changed'; range: { from: string; to: string } }
