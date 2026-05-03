import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  builtinVariableTypes,
  createCrossFilterAddon,
  createDashboardEngine,
  createEditorAddon,
} from '@loykin/dashboardkit'
import { createBrowserDashboardStateStore } from '@loykin/dashboardkit/url-state'
import {
  DashboardGrid,
  useConfigChanged,
  useEngineEvent,
  useLoadDashboard,
  usePanel,
  useVariable,
} from '@loykin/dashboardkit/react'
import type {
  CoreEngineAPI,
  DashboardInput,
  DashboardStateStore,
  DatasourcePluginDef,
  OptionField,
  PanelInput,
  VariableInput,
} from '@loykin/dashboardkit'
import type { PanelRenderProps } from '@loykin/dashboardkit/react'
import { barPanel, salesDs, statPanel, tablePanel, PANEL_TYPES } from './data'
import type { SalesOptions } from './data'

// ── Datasource plugin registry ────────────────────────────────────────────────
// Maps plugin type id → plugin definition (the code/logic layer)
// In a real app these would be npm-installed or dynamically imported plugins.
const DS_PLUGIN_TYPES: Record<string, DatasourcePluginDef> = {
  sales: salesDs as DatasourcePluginDef,
}

// ── Datasource instance records (simulating backend/localStorage persistence) ─
// Instances = configured deployments of a plugin type.
// This is what a /api/datasources endpoint would store server-side.
interface DsRecord {
  uid: string
  type: string
  name: string
  options: Record<string, unknown>
}

const DEFAULT_DS_RECORDS: DsRecord[] = [
  { uid: 'sales', type: 'sales', name: 'Sales DB', options: { delayMs: 250 } satisfies SalesOptions },
]

function loadDsRecords(): DsRecord[] {
  try {
    const stored = localStorage.getItem('ds-instances')
    return stored ? (JSON.parse(stored) as DsRecord[]) : DEFAULT_DS_RECORDS
  } catch { return DEFAULT_DS_RECORDS }
}

function saveDsRecords(records: DsRecord[]) {
  localStorage.setItem('ds-instances', JSON.stringify(records))
}

// ── App context ───────────────────────────────────────────────────────────────

interface AppCtx {
  engine: CoreEngineAPI
  stateStore: DashboardStateStore
  dsRecords: DsRecord[]
  setDsRecords(records: DsRecord[]): void
}

const AppContext = createContext<AppCtx | null>(null)
function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppContext.Provider')
  return ctx
}

// ── Initial dashboard ─────────────────────────────────────────────────────────

const INITIAL_DASHBOARD: DashboardInput = {
  schemaVersion: 1,
  id: 'sales',
  title: 'Sales Dashboard',
  layout: { cols: 24, rowHeight: 36 },
  variables: [
    { name: 'country',  type: 'query', label: 'Country',  dataRequest: { id: 'q', uid: 'sales', type: 'sales', query: 'countries' } },
    { name: 'platform', type: 'query', label: 'Platform', dataRequest: { id: 'q', uid: 'sales', type: 'sales', query: 'platforms' } },
  ],
  panels: [
    { id: 'total',    type: 'stat',  title: 'Total Revenue', gridPos: { x: 0,  y: 0, w: 6,  h: 4 }, dataRequests: [{ id: 'q', uid: 'sales', type: 'sales', options: { by: 'total',    country: '$country', platform: '$platform' } }] },
    { id: 'country',  type: 'bar',   title: 'By Country',    gridPos: { x: 6,  y: 0, w: 9,  h: 8 }, dataRequests: [{ id: 'q', uid: 'sales', type: 'sales', options: { by: 'country',  country: '$country', platform: '$platform' } }] },
    { id: 'platform', type: 'bar',   title: 'By Platform',   gridPos: { x: 15, y: 0, w: 9,  h: 8 }, dataRequests: [{ id: 'q', uid: 'sales', type: 'sales', options: { by: 'platform', country: '$country', platform: '$platform' } }] },
    { id: 'quarter',  type: 'bar',   title: 'By Quarter',    gridPos: { x: 0,  y: 4, w: 12, h: 8 }, dataRequests: [{ id: 'q', uid: 'sales', type: 'sales', options: { by: 'quarter',  country: '$country', platform: '$platform' } }] },
    { id: 'detail',   type: 'table', title: 'Sales Detail',  gridPos: { x: 12, y: 8, w: 12, h: 8 }, dataRequests: [{ id: 'q', uid: 'sales', type: 'sales', options: { by: 'detail',   country: '$country', platform: '$platform' } }] },
  ],
}

const PANEL_DIMENSION: Record<string, string> = {
  country: 'country', platform: 'platform', quarter: 'quarter',
}

// ── Panel content renderers ────────────────────────────────────────────────────

// transform guarantees [number, string] — see statPanel.transform in data.ts
function StatPreview({ row }: { row: unknown[] }) {
  return (
    <div>
      <div className="stat-value">{Number(row[0]).toLocaleString()}</div>
      <div className="stat-sub">{String(row[1] ?? '')}</div>
    </div>
  )
}

function PanelLoadingOverlay({ loading }: { loading: boolean }) {
  if (!loading) return null
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(var(--bg-rgb, 255,255,255), 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 1,
    }}>
      <div className="panel-loading" style={{ background: 'none' }}>Loading…</div>
    </div>
  )
}

function StatContent({ panelId, engine }: { panelId: string; engine: CoreEngineAPI }) {
  const { data, loading, error } = usePanel<unknown[] | null>(engine, panelId)
  if (error)        return <div className="panel-error">{error}</div>
  if (!data && loading) return <div className="panel-loading">Loading…</div>
  if (!data)        return <div className="panel-loading">No data</div>
  return (
    <div style={{ position: 'relative', padding: '12px 14px' }}>
      <PanelLoadingOverlay loading={loading} />
      <StatPreview row={data} />
    </div>
  )
}

function BarContent({ panelId, engine, dimension }: { panelId: string; engine: CoreEngineAPI; dimension?: string }) {
  const cf = useMemo(() => createCrossFilterAddon(engine), [engine])
  const { data, loading, error } = usePanel<unknown[][]>(engine, panelId)
  const [scopes, setScopes] = useState(() => cf.getPanelSelections())
  useEngineEvent(engine, (e) => { if (e.type === 'panel-selection-changed') setScopes(cf.getPanelSelections()) })
  if (error)                      return <div className="panel-error">{error}</div>
  if (!data && loading)           return <div className="panel-loading">Loading…</div>
  const rows = Array.isArray(data) ? data : []
  const max  = Math.max(1, ...rows.map((r) => Number(r[1] ?? 0)))
  const activeScope = dimension ? Object.values(scopes).find((s) => dimension in s) : undefined
  const activeVal   = activeScope ? String(activeScope[dimension!]) : null
  return (
    <div style={{ position: 'relative', padding: '8px 12px', overflowY: 'auto', height: '100%' }}>
      <PanelLoadingOverlay loading={loading} />
      {rows.map((row) => {
        const label = String(row[0]); const val = Number(row[1] ?? 0)
        const isActive = activeVal === label; const isFaded = !!activeVal && !isActive
        return (
          <div key={label}
            className={`bar-row${isActive ? ' active' : ''}${isFaded ? ' faded' : ''}`}
            onClick={() => {
              if (!dimension) return
              if (isActive) cf.clearPanelSelection(panelId)
              else          cf.setPanelSelection(panelId, { [dimension]: label })
            }}
          >
            <span className={`bar-label${isActive ? ' active-label' : ''}`}>{label}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(val / max) * 100}%` }} /></div>
            <span className="bar-val">{val.toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}

function TableContent({ panelId, engine }: { panelId: string; engine: CoreEngineAPI }) {
  const { data, loading, error } = usePanel<unknown[][]>(engine, panelId)
  if (error)              return <div className="panel-error">{error}</div>
  if (!data && loading)   return <div className="panel-loading">Loading…</div>
  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0)  return <div className="panel-loading">No data</div>
  const headers = rows[0]?.length === 4
    ? ['Country', 'Platform', 'Quarter', 'Revenue']
    : ['Dimension', 'Value']
  return (
    <div style={{ position: 'relative', overflowY: 'auto', height: '100%' }}>
      <PanelLoadingOverlay loading={loading} />
      <table className="ex-table">
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => <td key={j}>{j === 3 ? Number(cell).toLocaleString() : String(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PanelContent({ props, engine }: { props: PanelRenderProps; engine: CoreEngineAPI }) {
  const dim = PANEL_DIMENSION[props.instance.originId ?? '']
  if (props.panelType === 'stat')  return <StatContent  panelId={props.panelId} engine={engine} />
  if (props.panelType === 'bar')   return <BarContent   panelId={props.panelId} engine={engine} dimension={dim} />
  if (props.panelType === 'table') return <TableContent panelId={props.panelId} engine={engine} />
  return <div className="panel-loading">Unknown type: {props.panelType}</div>
}

// ── Cross-filter chips ─────────────────────────────────────────────────────────

function FilterChips({ engine }: { engine: CoreEngineAPI }) {
  const cf = useMemo(() => createCrossFilterAddon(engine), [engine])
  const [scopes, setScopes] = useState(() => cf.getPanelSelections())
  useEngineEvent(engine, (e) => { if (e.type === 'panel-selection-changed') setScopes(cf.getPanelSelections()) })
  const chips = Object.entries(scopes).flatMap(([panelId, filters]) =>
    Object.entries(filters).map(([dim, val]) => ({ panelId, dim, val: String(val) }))
  )
  if (chips.length === 0) return null
  return (
    <>
      <span style={{ width: 1, height: 18, background: 'var(--border)', display: 'inline-block', margin: '0 4px' }} />
      {chips.map(({ panelId, dim, val }) => (
        <span key={`${panelId}-${dim}`} className="filter-chip">
          {dim}: <strong>{val}</strong>
          <button onClick={() => cf.clearPanelSelection(panelId)}>✕</button>
        </span>
      ))}
      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 7px' }}
        onClick={() => cf.clearAllPanelSelections()}>Clear</button>
    </>
  )
}

// ── Variable bar ───────────────────────────────────────────────────────────────

function VarDropdown({ engine, name }: { engine: CoreEngineAPI; name: string }) {
  const { value, options, loading, setValue } = useVariable(engine, name)
  if (!loading && options.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span className="varbar-label">{name}</span>
      <select
        className="ex-select"
        style={{ width: 'auto', minWidth: 90 }}
        value={String(value)}
        onChange={(e) => setValue(e.target.value)}
        disabled={loading}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function VariableBar({ engine }: { engine: CoreEngineAPI }) {
  const [varNames, setVarNames] = useState<string[]>(
    () => engine.getConfig()?.variables.map((v) => v.name) ?? []
  )
  useEngineEvent(engine, (e) => {
    if (e.type === 'config-changed') setVarNames(e.config.variables.map((v) => v.name))
  })
  if (varNames.length === 0) return null
  return (
    <div className="varbar">
      {varNames.map((name) => <VarDropdown key={name} engine={engine} name={name} />)}
    </div>
  )
}

// ── Time picker ────────────────────────────────────────────────────────────────

const TIME_OPTIONS = [
  { label: 'Last 15m', from: 'now-15m', to: 'now' },
  { label: 'Last 1h',  from: 'now-1h',  to: 'now' },
  { label: 'Last 6h',  from: 'now-6h',  to: 'now' },
  { label: 'Last 1d',  from: 'now-1d',  to: 'now' },
  { label: 'Last 7d',  from: 'now-7d',  to: 'now' },
]

function TimePicker({ stateStore }: { stateStore: DashboardStateStore }) {
  const [current, setCurrent] = useState(() => stateStore.getSnapshot().timeRange)
  useEffect(() => stateStore.subscribe((s) => setCurrent(s.timeRange)), [stateStore])
  return (
    <select
      className="ex-select"
      style={{ width: 'auto' }}
      value={current ? `${current.from}|${current.to}` : ''}
      onChange={(e) => {
        const [from, to] = e.target.value.split('|')
        if (from && to) stateStore.setPatch({ timeRange: { from, to } })
      }}
    >
      {!current && <option value="">No time range</option>}
      {TIME_OPTIONS.map((o) => <option key={o.from} value={`${o.from}|${o.to}`}>{o.label}</option>)}
    </select>
  )
}

// ── Generic schema form ────────────────────────────────────────────────────────
// Renders an OptionSchema as a form — used for datasource config when
// the plugin does not supply a custom configEditor component.

function SchemaForm({
  schema, value, onChange,
}: {
  schema: Record<string, OptionField>
  value: Record<string, unknown>
  onChange(v: Record<string, unknown>): void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.entries(schema).map(([key, field]) => (
        <div key={key} className="field">
          <label className="field-label">{field.label}</label>
          {field.description && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{field.description}</div>
          )}
          {(field.type === 'string' || field.type === 'color') && (
            <input className="ex-input" type={field.type === 'color' ? 'color' : 'text'}
              value={String(value[key] ?? field.default ?? '')}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
          )}
          {field.type === 'number' && (
            <input className="ex-input" type="number"
              value={String(value[key] ?? field.default ?? 0)}
              min={field.min} max={field.max}
              step={field.step ?? (field.integer ? 1 : undefined)}
              onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} />
          )}
          {field.type === 'boolean' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox"
                checked={Boolean(value[key] ?? field.default ?? false)}
                onChange={(e) => onChange({ ...value, [key]: e.target.checked })} />
              {field.label}
            </label>
          )}
          {field.type === 'select' && (
            <select className="ex-select"
              value={String(value[key] ?? field.default ?? '')}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}>
              {field.choices?.map((c) => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Dashboard layout — wraps all /dashboards/* routes ─────────────────────────
// Aborts pending panel queries when the user leaves the dashboard section entirely.

function DashboardLayout() {
  const { engine } = useApp()
  useEffect(() => () => engine.abortAll(), [engine])
  return <Outlet />
}

// ── Route: /dashboards/:dashboardId ───────────────────────────────────────────

function DashboardPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>()
  const nav = useNavigate()
  const { engine, stateStore } = useApp()
  const [dirty, setDirty] = useState(false)

  useConfigChanged(engine, () => setDirty(true))

  function addPanel() {
    const cfg = engine.getConfig(); if (!cfg) return
    const maxY = cfg.panels.reduce((m, p) => Math.max(m, p.gridPos.y + p.gridPos.h), 0)
    const id = `panel-${Date.now()}`
    const p: PanelInput = {
      id, type: 'bar', title: 'New panel',
      gridPos: { x: 0, y: maxY, w: 12, h: 8 },
      dataRequests: [{ id: 'q', uid: 'sales', type: 'sales', options: { by: 'country' } }],
    }
    void engine.load({ ...cfg, panels: [...cfg.panels, p] }, { statePolicy: 'preserve' })
  }

  const dash = dashboardId ?? 'sales'

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">
          {dirty && <span className="unsaved-dot" title="Unsaved changes" />}
          Sales Dashboard
        </span>
        <FilterChips engine={engine} />
        <div className="topbar-spacer" />
        <TimePicker stateStore={stateStore} />
        <button className="btn" onClick={() => nav(`/dashboards/${dash}/variables`)}>⚙ Variables</button>
        <button className="btn" onClick={() => nav('/datasources')}>Datasources</button>
        <button className="btn btn-primary" onClick={addPanel}>+ Add panel</button>
      </div>
      <VariableBar engine={engine} />
      <div className="main">
        <div className="grid-area">
          <DashboardGrid engine={engine} editable>
            {(props) => {
              const originId = props.instance.originId ?? props.instance.id
              return (
                <div className="panel">
                  <div className="panel-header" onDoubleClick={() => nav(`/dashboards/${dash}/panels/${originId}/edit`)}>
                    <span className="panel-title">{props.instance.config.title || '(untitled)'}</span>
                    <button className="panel-edit-btn" onClick={() => nav(`/dashboards/${dash}/panels/${originId}/edit`)}>Edit</button>
                  </div>
                  <div className="panel-body" style={{ padding: 0, overflow: 'hidden' }}>
                    <PanelContent props={props} engine={engine} />
                  </div>
                </div>
              )
            }}
          </DashboardGrid>
        </div>
      </div>
    </>
  )
}

// ── Route: /dashboards/:dashboardId/panels/:panelId/edit ──────────────────────

interface QueryDraft {
  id: string
  uid: string
  dsType: string
  queryJson: string    // JSON string of request.query (optional)
  optionsJson: string  // JSON string of request.options
}

function tryJson(v: unknown): string {
  if (v === undefined || v === null) return ''
  try { return JSON.stringify(v, null, 2) } catch { return '' }
}

function parseJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return undefined }
}

function QueryEditor({
  draft, index, dsRecords, onChange, onRemove, canRemove,
}: {
  draft: QueryDraft
  index: number
  dsRecords: DsRecord[]
  onChange(d: QueryDraft): void
  onRemove(): void
  canRemove: boolean
}) {
  const ds = dsRecords.find((r) => r.uid === draft.uid)
  const plugin = DS_PLUGIN_TYPES[draft.dsType]
  const querySchema = plugin?.editor?.querySchema

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10 }}>
      {/* Query header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-alt, #f9f9f9)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>#{index + 1}</span>
        <select
          className="ex-select"
          style={{ flex: 1 }}
          value={draft.uid}
          onChange={(e) => {
            const rec = dsRecords.find((r) => r.uid === e.target.value)
            if (rec) onChange({ ...draft, uid: rec.uid, dsType: rec.type })
          }}
        >
          {dsRecords.map((r) => (
            <option key={r.uid} value={r.uid}>{r.name} ({r.type})</option>
          ))}
        </select>
        {ds && <span className="badge badge-gray" style={{ fontSize: 10 }}>{ds.type}</span>}
        {canRemove && (
          <button className="btn btn-ghost btn-danger btn-icon" style={{ fontSize: 13 }} onClick={onRemove}>✕</button>
        )}
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Query text (optional — for SQL/PromQL style datasources) */}
        <div className="field">
          <label className="field-label">Query <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — for text-based datasources)</span></label>
          <textarea
            className="ex-input"
            style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 56, resize: 'vertical' }}
            placeholder={'e.g. SELECT * FROM sales WHERE country = \'$country\''}
            value={draft.queryJson}
            onChange={(e) => onChange({ ...draft, queryJson: e.target.value })}
          />
        </div>

        {/* Options — SchemaForm if plugin has configSchema, else JSON textarea */}
        <div className="field">
          <label className="field-label">Options</label>
          {querySchema && Object.keys(querySchema).length > 0 ? (
            <SchemaForm
              schema={querySchema}
              value={(parseJson(draft.optionsJson) as Record<string, unknown>) ?? {}}
              onChange={(v) => onChange({ ...draft, optionsJson: tryJson(v) })}
            />
          ) : (
            <textarea
              className="ex-input"
              style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 72, resize: 'vertical' }}
              value={draft.optionsJson}
              onChange={(e) => onChange({ ...draft, optionsJson: e.target.value })}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function PanelEditorPage() {
  const { dashboardId, panelId: panelOriginId } = useParams<{ dashboardId: string; panelId: string }>()
  const nav = useNavigate()
  const { engine, dsRecords } = useApp()
  const back = useCallback(() => nav(`/dashboards/${dashboardId ?? 'sales'}`), [nav, dashboardId])

  const initPanel = engine.getConfig()?.panels.find((p) => p.id === panelOriginId) ?? null

  function initDrafts(panel: typeof initPanel): QueryDraft[] {
    if (!panel || panel.dataRequests.length === 0) {
      const first = dsRecords[0]
      return [{ id: 'q', uid: first?.uid ?? '', dsType: first?.type ?? '', queryJson: '', optionsJson: '{}' }]
    }
    return panel.dataRequests.map((r) => ({
      id: r.id,
      uid: r.uid,
      dsType: r.type,
      queryJson: r.query !== undefined ? tryJson(r.query) : '',
      optionsJson: tryJson(r.options ?? {}),
    }))
  }

  const [title,   setTitle]   = useState(initPanel?.title ?? '')
  const [type,    setType]    = useState(initPanel?.type  ?? 'bar')
  const [drafts,  setDrafts]  = useState<QueryDraft[]>(() => initDrafts(initPanel))
  const [previewData,   setPreviewData]   = useState<unknown | null>(null)
  const [previewStatus, setPreviewStatus] = useState<string>('Loading…')
  const [previewing,    setPreviewing]    = useState(false)
  const [busy,          setBusy]          = useState(false)

  // keep refs so callbacks don't go stale
  const titleRef  = useRef(title);  titleRef.current  = title
  const typeRef   = useRef(type);   typeRef.current   = type
  const draftsRef = useRef(drafts); draftsRef.current = drafts

  function buildDataRequests() {
    return draftsRef.current
      .filter((d) => d.uid)
      .map((d) => {
        const rec = dsRecords.find((r) => r.uid === d.uid)
        const base = {
          id: d.id || 'q',
          uid: d.uid,
          type: rec?.type ?? d.dsType,
        }
        const query   = d.queryJson.trim() ? parseJson(d.queryJson) as string | string[] | Record<string, unknown> | undefined : undefined
        const options = (d.optionsJson.trim() ? parseJson(d.optionsJson) ?? {} : {}) as Record<string, unknown>
        return { ...base, ...(query !== undefined ? { query } : {}), options }
      })
  }

  function buildPatch() {
    return { title: titleRef.current, type: typeRef.current, dataRequests: buildDataRequests() }
  }

  function getInstanceId() {
    return engine.getPanelInstances().find((p) => p.originId === panelOriginId)?.id ?? null
  }

  const runPreview = useCallback(async () => {
    const instId = getInstanceId()
    const currentPanel = engine.getConfig()?.panels.find((p) => p.id === panelOriginId)
    if (!instId || !currentPanel) return
    setPreviewing(true); setPreviewStatus('Loading…')
    try {
      const patch = buildPatch()
      const { data, rawData } = await createEditorAddon(engine).previewPanel(instId, { ...currentPanel, ...patch })
      setPreviewData(data)
      setPreviewStatus(`${rawData[0]?.rows.length ?? 0} rows`)
    } catch (err) {
      setPreviewStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      setPreviewData(null)
    } finally { setPreviewing(false) }
  }, [engine, panelOriginId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => { void runPreview() }, 400)
    return () => clearTimeout(t)
  }, [type, drafts, runPreview])

  if (!initPanel) {
    return (
      <div className="editor-screen">
        <div className="editor-topbar">
          <button className="btn btn-ghost" onClick={back}>← Back</button>
        </div>
        <div style={{ padding: 32, color: 'var(--text-muted)' }}>Panel not found</div>
      </div>
    )
  }

  async function handleApply() {
    setBusy(true)
    try { await engine.updatePanel(panelOriginId!, buildPatch()); back() }
    finally { setBusy(false) }
  }

  function addQuery() {
    const first = dsRecords[0]
    setDrafts((prev) => [
      ...prev,
      { id: `q${prev.length + 1}`, uid: first?.uid ?? '', dsType: first?.type ?? '', queryJson: '', optionsJson: '{}' },
    ])
  }

  const previewRows = Array.isArray(previewData) && Array.isArray((previewData as unknown[][])[0])
    ? previewData as unknown[][]
    : null
  const cols = previewRows?.[0]?.length ?? 0

  return (
    <div className="editor-screen">
      <div className="editor-topbar">
        <button className="btn btn-ghost" onClick={back}>← Back to dashboard</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Edit: {title}</span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => void runPreview()} disabled={previewing || busy}>
          {previewing ? 'Running…' : 'Preview'}
        </button>
        <button className="btn btn-primary" onClick={() => void handleApply()} disabled={busy}>Apply</button>
      </div>

      <div className="editor-body">
        {/* Left col: preview (top) + query editor (bottom) */}
        <div className="editor-left">
          {/* Preview */}
          <div className="editor-preview">
            <div style={{ marginBottom: 10, fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Preview — {previewStatus}
            </div>
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">{title}</span>
                <span className="badge badge-gray">{type}</span>
              </div>
              <div style={{ padding: '10px 12px', overflowY: 'auto', maxHeight: 340 }}>
                {previewData === null ? (
                  <div className="panel-loading">Loading…</div>
                ) : type === 'stat' ? (
                  <StatPreview row={previewData as unknown[]} />
                ) : !previewRows || previewRows.length === 0 ? (
                  <div className="panel-loading">No data returned</div>
                ) : type === 'bar' ? (
                  (() => {
                    const max = Math.max(1, ...previewRows.map((r) => Number(r[1] ?? 0)))
                    return previewRows.map((row) => {
                      const val = Number(row[1] ?? 0)
                      return (
                        <div key={String(row[0])} className="bar-row">
                          <span className="bar-label">{String(row[0])}</span>
                          <div className="bar-track"><div className="bar-fill" style={{ width: `${(val / max) * 100}%` }} /></div>
                          <span className="bar-val">{val.toLocaleString()}</span>
                        </div>
                      )
                    })
                  })()
                ) : (
                  <table className="ex-table">
                    <thead><tr>{Array.from({ length: cols }, (_, i) => <th key={i}>col {i + 1}</th>)}</tr></thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Query editor */}
          <div className="editor-query">
            <div className="editor-query-header">
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Query</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={addQuery}>
                + Add query
              </button>
            </div>
            <div className="editor-query-body">
              {drafts.map((draft, i) => (
                <QueryEditor
                  key={draft.id + i}
                  draft={draft}
                  index={i}
                  dsRecords={dsRecords}
                  onChange={(d) => setDrafts((prev) => prev.map((x, xi) => xi === i ? d : x))}
                  onRemove={() => setDrafts((prev) => prev.filter((_, xi) => xi !== i))}
                  canRemove={drafts.length > 1}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right col: panel options */}
        <div className="editor-form">
          <div className="editor-form-section">
            <div className="drawer-section-title">Panel</div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">Title</label>
              <input className="ex-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Visualization</label>
              <select className="ex-select" value={type} onChange={(e) => setType(e.target.value)}>
                {PANEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="editor-form-section">
            <div className="drawer-section-title">Danger</div>
            <button
              className="btn btn-danger"
              onClick={() => {
                const cfg = engine.getConfig(); if (!cfg) return
                void engine.load({ ...cfg, panels: cfg.panels.filter((p) => p.id !== panelOriginId) })
                back()
              }}
            >
              Remove panel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Route: /dashboards/:dashboardId/variables ─────────────────────────────────

function VariablesPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>()
  const nav = useNavigate()
  const { engine } = useApp()
  const [cfg,    setCfg]    = useState(() => engine.getConfig())
  const [name,   setName]   = useState('')
  const [values, setValues] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEngineEvent(engine, (e) => { if (e.type === 'config-changed') setCfg(e.config) })

  const variables = cfg?.variables ?? []

  async function addVar() {
    if (!name.trim()) return
    setBusy(true); setStatus(null)
    const opts = values.split(',').map((v) => v.trim()).filter(Boolean)
    const def: VariableInput = opts.length > 0
      ? { name: name.trim(), type: 'custom', options: { values: opts.join(',') }, defaultValue: opts[0] }
      : { name: name.trim(), type: 'textbox', defaultValue: '' }
    await engine.addVariable(def, { refresh: true })
    setStatus(`"$${name.trim()}" registered`)
    setName(''); setValues(''); setBusy(false)
  }

  return (
    <div className="editor-screen">
      <div className="editor-topbar">
        <button className="btn btn-ghost" onClick={() => nav(`/dashboards/${dashboardId ?? 'sales'}`)}>← Back</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Variables</span>
      </div>
      <div style={{ maxWidth: 640, margin: '32px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <div className="drawer-section-title" style={{ marginBottom: 12 }}>Dashboard variables</div>
          {variables.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No variables defined.</p>}
          {variables.map((v) => (
            <div key={v.name} className="var-item" style={{ marginBottom: 8 }}>
              <div>
                <div className="var-item-name">${v.name}</div>
                <div className="var-item-meta">{v.type}{v.label ? ` · ${v.label}` : ''}</div>
              </div>
              <button
                className="btn btn-ghost btn-danger btn-icon"
                style={{ fontSize: 14 }}
                onClick={() => {
                  if (!cfg) return
                  void engine.load(
                    { ...cfg, variables: cfg.variables.filter((vv) => vv.name !== v.name) },
                    { statePolicy: 'preserve' },
                  )
                }}
              >✕</button>
            </div>
          ))}
        </div>
        <div>
          <div className="drawer-section-title" style={{ marginBottom: 12 }}>Add variable</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field">
              <label className="field-label">Name</label>
              <input className="ex-input" placeholder="e.g. region" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Values (comma-separated — leave empty for textbox)</label>
              <input className="ex-input" placeholder="e.g. US, KR, JP, EU" value={values} onChange={(e) => setValues(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
              disabled={busy || !name.trim()} onClick={() => void addVar()}>
              {busy ? 'Adding…' : 'Add variable'}
            </button>
            {status && <div className="info-box">{status}</div>}
          </div>
        </div>
        <div className="info-box">
          Variables are interpolated as <code>$name</code> and synced to the URL (<code>?var-name=value</code>).
        </div>
      </div>
    </div>
  )
}

// ── Route: /datasources ────────────────────────────────────────────────────────

function DatasourceListPage() {
  const nav = useNavigate()
  const { dsRecords } = useApp()

  return (
    <div className="editor-screen">
      <div className="editor-topbar">
        <button className="btn btn-ghost" onClick={() => nav('/dashboards/sales')}>← Dashboard</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Datasources</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => nav('/datasources/new')}>+ Add datasource</button>
      </div>
      <div style={{ maxWidth: 720, margin: '32px auto', padding: '0 24px' }}>
        <div className="drawer-section-title" style={{ marginBottom: 12 }}>Configured instances</div>
        {dsRecords.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No datasources configured.</p>
        )}
        {dsRecords.map((ds) => {
          const plugin = DS_PLUGIN_TYPES[ds.type]
          return (
            <div key={ds.uid} className="var-item" style={{ marginBottom: 8, cursor: 'pointer' }}
              onClick={() => nav(`/datasources/${ds.uid}/edit`)}>
              <div>
                <div className="var-item-name">{ds.name}</div>
                <div className="var-item-meta">
                  uid: <code>{ds.uid}</code> · type: {ds.type}
                  {plugin?.name ? ` (${plugin.name})` : ''}
                </div>
              </div>
              <button className="btn btn-ghost btn-icon"
                onClick={(e) => { e.stopPropagation(); nav(`/datasources/${ds.uid}/edit`) }}>
                Edit →
              </button>
            </div>
          )
        })}
        <div className="info-box" style={{ marginTop: 24 }}>
          Datasource instances are referenced by panels via <code>uid</code>.
          Plugin types define query logic; instances hold connection config.
          In production this list would come from a backend API.
        </div>
      </div>
    </div>
  )
}

// ── Route: /datasources/new  and  /datasources/:uid/edit ──────────────────────

function DatasourceEditPage() {
  const { uid } = useParams<{ uid: string }>()
  const nav = useNavigate()
  const { engine, dsRecords, setDsRecords } = useApp()

  const isNew = uid === 'new' || !uid

  const [selectedType, setSelectedType] = useState(Object.keys(DS_PLUGIN_TYPES)[0] ?? 'sales')
  const [dsUid,   setDsUid]   = useState(isNew ? '' : (uid ?? ''))
  const [dsName,  setDsName]  = useState('')
  const [options, setOptions] = useState<Record<string, unknown>>({})
  const [health,  setHealth]  = useState<{ ok: boolean; message?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [busy,    setBusy]    = useState(false)

  useEffect(() => {
    if (isNew) {
      const plugin = DS_PLUGIN_TYPES[selectedType]
      setOptions((plugin?.connector?.defaultConfig as Record<string, unknown>) ?? {})
      setDsName(plugin?.name ?? selectedType)
    } else {
      const rec = dsRecords.find((r) => r.uid === uid)
      if (rec) {
        setSelectedType(rec.type)
        setDsName(rec.name)
        setOptions(rec.options)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const plugin = DS_PLUGIN_TYPES[selectedType]
  const configSchema = plugin?.connector?.configSchema ?? {}

  async function handleTest() {
    if (!plugin?.connector?.healthCheck) {
      setHealth({ ok: true, message: 'No health check defined for this plugin type' })
      return
    }
    setTesting(true); setHealth(null)
    try {
      const result = await plugin.connector.healthCheck(options as never, {})
      setHealth(result)
    } catch (err) {
      setHealth({ ok: false, message: String(err) })
    } finally { setTesting(false) }
  }

  async function handleSave() {
    const effectiveUid = isNew ? dsUid.trim() : (uid ?? '')
    if (!effectiveUid) return
    setBusy(true)
    const rec: DsRecord = {
      uid: effectiveUid,
      type: selectedType,
      name: dsName.trim() || effectiveUid,
      options,
    }
    const updated = isNew
      ? [...dsRecords, rec]
      : dsRecords.map((r) => r.uid === effectiveUid ? rec : r)
    saveDsRecords(updated)
    setDsRecords(updated)
    // Register (or re-register) the datasource in the running engine
    engine.registerDatasource({ ...plugin, uid: effectiveUid, options } as DatasourcePluginDef)
    setBusy(false)
    nav('/datasources')
  }

  function handleDelete() {
    if (!uid || isNew) return
    const updated = dsRecords.filter((r) => r.uid !== uid)
    saveDsRecords(updated)
    setDsRecords(updated)
    nav('/datasources')
  }

  // If the plugin supplies a custom config UI, prefer it; otherwise use SchemaForm.
  const CustomEditor = plugin?.connector?.configEditor as
    | ((props: { value: Record<string, unknown>; onChange(v: Record<string, unknown>): void }) => React.ReactNode)
    | undefined

  return (
    <div className="editor-screen">
      <div className="editor-topbar">
        <button className="btn btn-ghost" onClick={() => nav('/datasources')}>← Datasources</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {isNew ? 'Add datasource' : `Edit: ${dsName || uid}`}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => void handleTest()} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={busy || (isNew && !dsUid.trim())}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ maxWidth: 640, margin: '32px auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {health && (
          <div className="info-box" style={{
            borderColor: health.ok ? '#86efac' : '#fca5a5',
            background:  health.ok ? '#f0fdf4' : '#fef2f2',
            color:       health.ok ? '#166534' : '#991b1b',
          }}>
            {health.ok ? '✓' : '✗'} {health.message ?? (health.ok ? 'Connected' : 'Failed')}
          </div>
        )}

        {/* Connection metadata */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
          <div className="drawer-section-title" style={{ marginBottom: 12 }}>Connection</div>
          {isNew && (
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">Plugin type</label>
              <select className="ex-select" value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value)
                  const p = DS_PLUGIN_TYPES[e.target.value]
                  setOptions((p?.connector?.defaultConfig as Record<string, unknown>) ?? {})
                }}>
                {Object.entries(DS_PLUGIN_TYPES).map(([type, p]) => (
                  <option key={type} value={type}>{p.name ?? type}</option>
                ))}
              </select>
            </div>
          )}
          {isNew && (
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="field-label">UID (unique identifier)</label>
              <input className="ex-input" placeholder="e.g. my-sales-db"
                value={dsUid} onChange={(e) => setDsUid(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label className="field-label">Display name</label>
            <input className="ex-input" value={dsName} onChange={(e) => setDsName(e.target.value)} />
          </div>
        </div>

        {/* Plugin-specific settings */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
          <div className="drawer-section-title" style={{ marginBottom: 12 }}>Plugin settings</div>
          {CustomEditor ? (
            <CustomEditor value={options} onChange={setOptions} />
          ) : Object.keys(configSchema).length > 0 ? (
            <SchemaForm schema={configSchema} value={options} onChange={setOptions} />
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No configuration options for this plugin.</p>
          )}
        </div>

        {!isNew && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
            <div className="drawer-section-title" style={{ marginBottom: 12 }}>Danger</div>
            <button className="btn btn-danger" onClick={handleDelete}>Delete datasource</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── App root ───────────────────────────────────────────────────────────────────

export function App() {
  const stateStore = useMemo(() => createBrowserDashboardStateStore(), [])
  const [dsRecords, setDsRecords] = useState<DsRecord[]>(() => loadDsRecords())

  // Engine is created once with the initial datasource instances from storage.
  // Dynamic updates (add/edit/delete from CRUD screen) call engine.registerDatasource() directly.
  const engine = useMemo(() => {
    const plugins = dsRecords
      .map((r) => {
        const p = DS_PLUGIN_TYPES[r.type]
        return p ? ({ ...p, uid: r.uid, options: r.options } as DatasourcePluginDef) : null
      })
      .filter((p): p is DatasourcePluginDef => p !== null)
    const e = createDashboardEngine({
      panels: [statPanel, barPanel, tablePanel],
      datasourcePlugins: plugins,
      variableTypes: builtinVariableTypes,
      stateStore,
    })
    // Load synchronously so getConfig() is non-null on first render.
    // useLoadDashboard below becomes a no-op (idempotency check skips same ref).
    e.load(INITIAL_DASHBOARD)
    return e
  }, [stateStore]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keeps engine in sync if INITIAL_DASHBOARD reference ever changes (no-op here).
  useLoadDashboard(engine, INITIAL_DASHBOARD)

  useEffect(() => () => engine.destroy(), [engine])

  const ctx = useMemo<AppCtx>(
    () => ({ engine, stateStore, dsRecords, setDsRecords }),
    [engine, stateStore, dsRecords],
  )

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboards/sales" replace />} />
          <Route element={<DashboardLayout />}>
            <Route path="/dashboards/:dashboardId" element={<DashboardPage />} />
            <Route path="/dashboards/:dashboardId/panels/:panelId/edit" element={<PanelEditorPage />} />
            <Route path="/dashboards/:dashboardId/variables" element={<VariablesPage />} />
          </Route>
          <Route path="/datasources" element={<DatasourceListPage />} />
          <Route path="/datasources/new" element={<DatasourceEditPage />} />
          <Route path="/datasources/:uid/edit" element={<DatasourceEditPage />} />
          <Route path="*" element={<Navigate to="/dashboards/sales" replace />} />
        </Routes>
      </div>
    </AppContext.Provider>
  )
}
