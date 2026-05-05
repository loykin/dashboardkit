import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createDashboardEngine,
  createEditorAddon,
  createMemoryDashboardStateStore,
  defineDatasource,
  definePanel,
  defineVariableType,
} from '@loykin/dashboardkit'
import {
  DashboardGrid,
  useConfigChanged,
  useLoadDashboard,
  usePanelDraftEditor,
  useVariable,
} from '@loykin/dashboardkit/react'
import type { CoreEngineAPI, DashboardInput, DashboardDatasourceQueryContext, QueryResult } from '@loykin/dashboardkit'
import type { PanelRenderProps } from '@loykin/dashboardkit/react'

type DashboardKey = 'ops' | 'billing'

const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  optionsSchema: {
    title: { type: 'string', label: 'Title', required: true },
  },
  transform(results: QueryResult[]) {
    return results[0]?.rows ?? []
  },
})

const statPanel = definePanel({
  id: 'stat',
  name: 'Stat',
  optionsSchema: {
    title: { type: 'string', label: 'Title', required: true },
  },
  transform(results: QueryResult[]) {
    return results[0]?.rows.at(-1)?.[1] ?? null
  },
})

const staticVariable = defineVariableType({
  id: 'static',
  name: 'Static',
  optionsSchema: {},
  async resolve(config, options) {
    const values = Array.isArray((options as Record<string, unknown>).values)
      ? (options as Record<string, string[]>).values
      : []
    if (values.length > 0) return values.map((value) => ({ label: value, value }))
    const value = Array.isArray(config.defaultValue) ? config.defaultValue[0] : config.defaultValue
    return value ? [{ label: value, value }] : []
  },
})

const datasource = defineDatasource({
  uid: 'lifecycle-api',
  type: 'backend',
  async queryData(_request, options) {
    if (String(options.query ?? '').startsWith('builder.custom')) {
      const team = String(options.variables.team ?? '-')
      const rawQuery = String(options.query ?? '')
      const effectiveQuery = rawQuery.replace(/\$team/g, team)
      return {
        columns: [
          { name: 'scope', type: 'string' },
          { name: 'value', type: 'number' },
          { name: 'detail', type: 'string' },
        ],
        rows: [
          ['effective-query', 77 + team.length, effectiveQuery],
          ['raw-query', rawQuery.length, rawQuery],
          ['team', team, JSON.stringify(options.variables)],
          ['variable-count', Object.keys(options.variables).length, JSON.stringify(options.variables)],
        ],
        meta: {
          dashboardId: options.dashboardId,
          variables: options.variables,
          timeRange: options.timeRange,
        },
      }
    }
    const rows = buildRows(options)
    return {
      columns: [
        { name: 'dashboard', type: 'string' },
        { name: 'value', type: 'number' },
        { name: 'query', type: 'string' },
      ],
      rows,
      meta: {
        dashboardId: options.dashboardId,
        variables: options.variables,
        timeRange: options.timeRange,
      },
    }
  },
})

function buildRows(options: DashboardDatasourceQueryContext): unknown[][] {
  const dashboard = options.dashboardId
  const seed = dashboard === 'ops-dashboard' ? 40 : 90
  const region = String(options.variables.region ?? '-')
  const tenant = String(options.variables.tenant ?? '-')
  const team = String(options.variables.team ?? '')
  const query = String(options.query ?? '')
  return Array.from({ length: 4 }, (_, index) => [
    dashboard,
    seed + index * 7 + region.length + tenant.length + team.length,
    query,
  ])
}

const dashboards: Record<DashboardKey, DashboardInput> = {
  ops: {
    schemaVersion: 1,
    id: 'ops-dashboard',
    title: 'Ops Dashboard',
    layout: { cols: 24, rowHeight: 34 },
    variables: [
      { name: 'region', type: 'static', defaultValue: 'ap-northeast', options: { values: ['ap-northeast', 'us-east'] } },
    ],
    panels: [
      {
        id: 'ops-latency',
        type: 'stat',
        title: 'API latency',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        options: { title: 'API latency' },
        dataRequests: [{ id: 'main', uid: 'lifecycle-api', type: 'backend', query: 'ops.latency' }],
      },
      {
        id: 'ops-table',
        type: 'table',
        title: 'Regional services',
        gridPos: { x: 0, y: 4, w: 12, h: 6 },
        options: { title: 'Regional services' },
        dataRequests: [{ id: 'main', uid: 'lifecycle-api', type: 'backend', query: 'ops.services' }],
      },
    ],
  },
  billing: {
    schemaVersion: 1,
    id: 'billing-dashboard',
    title: 'Billing Dashboard',
    layout: { cols: 24, rowHeight: 34 },
    variables: [
      { name: 'tenant', type: 'static', defaultValue: 'enterprise', options: { values: ['enterprise', 'startup'] } },
    ],
    panels: [
      {
        id: 'billing-mrr',
        type: 'stat',
        title: 'MRR',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        options: { title: 'MRR' },
        dataRequests: [{ id: 'main', uid: 'lifecycle-api', type: 'backend', query: 'billing.mrr' }],
      },
      {
        id: 'billing-table',
        type: 'table',
        title: 'Accounts',
        gridPos: { x: 0, y: 4, w: 12, h: 6 },
        options: { title: 'Accounts' },
        dataRequests: [{ id: 'main', uid: 'lifecycle-api', type: 'backend', query: 'billing.accounts' }],
      },
    ],
  },
}

function keyFromUrl(): DashboardKey {
  const value = new URLSearchParams(window.location.search).get('dashboard')
  return value === 'billing' ? 'billing' : 'ops'
}

function navigateDashboard(key: DashboardKey) {
  const params = new URLSearchParams(window.location.search)
  params.set('tab', 'navigation-lifecycle')
  params.set('dashboard', key)
  window.history.pushState(window.history.state, '', `${window.location.pathname}?${params.toString()}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function NavigationLifecycleTab() {
  const stateStore = useMemo(() => createMemoryDashboardStateStore(), [])
  const engine = useMemo(() => createDashboardEngine({
    stateStore,
    panels: [tablePanel, statPanel],
    datasourcePlugins: [datasource],
    variableTypes: [staticVariable],
  }), [stateStore])
  const [savedDashboards, setSavedDashboards] = useState<Record<DashboardKey, DashboardInput>>(() => ({ ...dashboards }))
  const [dashboardKey, setDashboardKey] = useState<DashboardKey>(() => keyFromUrl())
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(savedDashboards[dashboardKey].panels[0]?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const [savedJson, setSavedJson] = useState('')
  const [builderStatus, setBuilderStatus] = useState('')
  const config = savedDashboards[dashboardKey]

  // Load boundary — only entry point for external config into engine
  useLoadDashboard(engine, config, { statePolicy: 'replace-dashboard-variables' })

  useConfigChanged(engine, () => setDirty(true))

  useEffect(() => {
    const sync = () => {
      const next = keyFromUrl()
      setDashboardKey(next)
      setSelectedPanelId(savedDashboards[next].panels[0]?.id ?? null)
      setDirty(false)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [savedDashboards])

  function markChanged(message: string) {
    setDirty(true)
    setBuilderStatus(message)
  }

  async function addPanel() {
    const id = `custom-${Date.now().toString(36)}`
    const hasTeam = engine.getConfig()?.variables.some((variable) => variable.name === 'team') ?? false
    await engine.addPanel({
      id,
      type: 'table',
      title: hasTeam ? 'Custom query for $team' : 'Custom query',
      gridPos: { x: 12, y: 0, w: 12, h: 6 },
      options: { title: hasTeam ? 'Custom query for $team' : 'Custom query' },
      dataRequests: [{
        id: 'main',
        uid: 'lifecycle-api',
        type: 'backend',
        query: hasTeam ? 'builder.custom.$team' : 'builder.custom',
      }],
    })
    setSelectedPanelId(id)
    markChanged(`Added panel ${id}`)
  }

  async function removeSelectedPanel() {
    if (!selectedPanelId) return
    await engine.removePanel(selectedPanelId)
    setSelectedPanelId(engine.getPanelInstances()[0]?.originId ?? null)
    markChanged(`Removed panel ${selectedPanelId}`)
  }

  async function addVariable() {
    const cfg = engine.getConfig()
    if (!cfg || cfg.variables.some((variable) => variable.name === 'team')) return
    await engine.addVariable({
      name: 'team',
      type: 'static',
      defaultValue: 'core',
      options: { values: ['core', 'growth'] },
    })
    markChanged('Added variable team')
  }

  async function removeVariable() {
    const cfg = engine.getConfig()
    if (!cfg || !cfg.variables.some((variable) => variable.name === 'team')) return
    await Promise.all(
      cfg.panels
        .filter((panel) => JSON.stringify(panel).includes('$team'))
        .map((panel) => engine.updatePanel(panel.id, {
          title: panel.title.replace(/\$team/g, 'team'),
          options: { ...panel.options, title: String(panel.options.title ?? panel.title).replace(/\$team/g, 'team') },
          dataRequests: panel.dataRequests.map((request) => ({
            ...request,
            query: typeof request.query === 'string' ? request.query.replace(/\$team/g, 'team') : request.query,
          })),
        }, { refresh: false })),
    )
    await engine.removeVariable('team')
    markChanged('Removed variable team')
  }

  async function updateTitle() {
    const cfg = engine.getConfig()
    if (!cfg) return
    await engine.updateDashboard({ title: `${cfg.title} *` })
    markChanged('Updated dashboard title')
  }

  function saveDashboard() {
    const cfg = engine.getConfig()
    if (!cfg) return
    setSavedDashboards((current) => ({ ...current, [dashboardKey]: cfg as DashboardInput }))
    setSavedJson(JSON.stringify(cfg, null, 2))
    setDirty(false)
    setBuilderStatus(`Saved ${cfg.title}`)
  }

  function reloadSaved() {
    engine.load(savedDashboards[dashboardKey], { statePolicy: 'replace-dashboard-variables' })
    setSelectedPanelId(savedDashboards[dashboardKey].panels[0]?.id ?? null)
    setDirty(false)
    setBuilderStatus('Reloaded saved config')
  }

  const currentConfig = engine.getConfig()
  const hasTeamVariable = currentConfig?.variables.some((variable) => variable.name === 'team') ?? false

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Builder lifecycle</h2>
        <p className="text-sm text-gray-500">
          Load a dashboard, mutate the engine-owned config, save with getConfig(), reload it, and switch pages without a second config source.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
        <button className={`rounded px-2 py-1 ${dashboardKey === 'ops' ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white'}`} onClick={() => navigateDashboard('ops')}>
          Ops dashboard
        </button>
        <button className={`rounded px-2 py-1 ${dashboardKey === 'billing' ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white'}`} onClick={() => navigateDashboard('billing')}>
          Billing dashboard
        </button>
        <button className="rounded border border-gray-300 bg-white px-2 py-1" onClick={() => history.back()}>Back</button>
        <button className="rounded border border-gray-300 bg-white px-2 py-1" onClick={() => history.forward()}>Forward</button>
        <span className={dirty ? 'text-amber-700' : 'text-gray-500'}>{dirty ? 'Unsaved config' : 'Clean config'}</span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-xs">
        <button className="rounded bg-gray-900 px-2 py-1 text-white" onClick={() => void addPanel()}>Add panel</button>
        <button
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
          disabled={!selectedPanelId}
          onClick={() => void removeSelectedPanel()}
        >
          Remove selected
        </button>
        <button
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
          disabled={hasTeamVariable}
          onClick={() => void addVariable()}
        >
          Add variable
        </button>
        <button
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
          disabled={!hasTeamVariable}
          onClick={() => void removeVariable()}
        >
          Remove variable
        </button>
        <button className="rounded border border-gray-300 px-2 py-1" onClick={() => void updateTitle()}>Update title</button>
        <button className="ml-auto rounded border border-gray-300 bg-white px-2 py-1" onClick={saveDashboard}>Save getConfig()</button>
        <button className="rounded border border-gray-300 bg-white px-2 py-1" onClick={reloadSaved}>Reload saved</button>
        {builderStatus && <span className="text-gray-500">{builderStatus}</span>}
      </div>
      <LifecycleVariables engine={engine} dashboardKey={dashboardKey} />
      <ConfigSummary config={currentConfig} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        {/* Render boundary — reads engine state only, no config prop */}
        <DashboardGrid engine={engine}>
          {(props) => (
            <div
              className={`h-full cursor-pointer ${selectedPanelId === props.instance.originId ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setSelectedPanelId(props.instance.originId)}
            >
              {renderPanel(props)}
            </div>
          )}
        </DashboardGrid>
        <LifecycleEditor engine={engine} panelId={selectedPanelId} />
      </div>
      {savedJson && (
        <details className="mt-4 rounded border border-gray-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600">Last saved config</summary>
          <pre className="max-h-80 overflow-auto border-t border-gray-200 p-3 text-[11px] text-gray-600">{savedJson}</pre>
        </details>
      )}
    </div>
  )
}

function LifecycleVariables({ engine, dashboardKey }: { engine: CoreEngineAPI; dashboardKey: DashboardKey }) {
  const hasTeam = engine.getConfig()?.variables.some((variable) => variable.name === 'team') ?? false
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {dashboardKey === 'ops'
        ? <VariableSelect engine={engine} name="region" label="Region" />
        : <VariableSelect engine={engine} name="tenant" label="Tenant" />}
      {hasTeam && <VariableSelect engine={engine} name="team" label="Team" />}
    </div>
  )
}

function VariableSelect({ engine, name, label }: { engine: CoreEngineAPI; name: string; label: string }) {
  const variable = useVariable(engine, name)
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs">
      <label className="font-medium text-gray-600">
        {label}
        <select
          className="ml-2 rounded border border-gray-300 px-2 py-1"
          value={String(variable.value)}
          onChange={(event) => variable.setValue(event.target.value)}
        >
          {variable.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </div>
  )
}

function ConfigSummary({ config }: { config: ReturnType<CoreEngineAPI['getConfig']> }) {
  if (!config) return null
  return (
    <div className="mb-4 grid gap-2 text-xs md:grid-cols-2">
      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
        <span className="font-medium text-gray-600">Variables</span>
        <span className="ml-2 text-gray-500">
          {config.variables.length === 0 ? 'none' : config.variables.map((variable) => variable.name).join(', ')}
        </span>
      </div>
      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
        <span className="font-medium text-gray-600">Panels</span>
        <span className="ml-2 text-gray-500">{config.panels.map((panel) => panel.id).join(', ')}</span>
      </div>
    </div>
  )
}

function renderPanel(props: PanelRenderProps) {
  if (props.loading) return <div className="p-3 text-xs text-gray-500">Loading</div>
  if (props.error) return <div className="p-3 text-xs text-red-600">{props.error}</div>
  if (props.panelType === 'stat') {
    return (
      <div className="flex h-full flex-col justify-between rounded border border-gray-200 bg-white p-4">
        <div className="text-xs uppercase text-gray-500">{props.config.title}</div>
        <div className="text-4xl font-semibold">{String(props.data ?? '-')}</div>
      </div>
    )
  }
  const rows = Array.isArray(props.data) ? props.data as unknown[][] : []
  return (
    <div className="h-full overflow-hidden rounded border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-3 py-2 text-sm font-semibold">{props.config.title}</div>
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-gray-100">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2" title={String(cell)}>{String(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LifecycleEditor({ engine, panelId }: { engine: CoreEngineAPI; panelId: string | null }) {
  const { instance, draftPanel, setDraft, resetDraft } = usePanelDraftEditor(engine, panelId)
  const [previewMeta, setPreviewMeta] = useState<string>('')

  // Uncontrolled refs — React never sets input.value, so Safari IME can commit freely
  const titleInputRef = useRef<HTMLInputElement>(null)
  const queryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!instance) return
    if (titleInputRef.current) titleInputRef.current.value = instance!.config.title
    if (queryInputRef.current) queryInputRef.current.value = String(instance.config.dataRequests[0]?.query ?? '')
    setPreviewMeta('')
  }, [instance?.id])

  if (!instance) return <aside className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">Select a panel.</aside>

  const firstRequest = instance.config.dataRequests[0]

  function readDraft() {
    const title = titleInputRef.current?.value ?? instance!.config.title
    const query = queryInputRef.current?.value ?? String(firstRequest?.query ?? '')
    return {
      title,
      options: { ...instance!.config.options, title },
      dataRequests: firstRequest ? [{ ...firstRequest, query }] : instance!.config.dataRequests,
    }
  }

  async function handleApply() {
    const draft = readDraft()
    await engine.updatePanel(panelId!, draft)
    resetDraft()
  }

  async function handlePreview() {
    const draft = readDraft()
    setDraft(draft)
    const result = await createEditorAddon(engine).previewPanel(panelId!, { ...instance!.config, ...draft })
    setPreviewMeta(JSON.stringify(result.rawData[0]?.meta ?? {}, null, 2))
  }

  function handleCancel() {
    if (titleInputRef.current) titleInputRef.current.value = instance!.config.title
    if (queryInputRef.current) queryInputRef.current.value = String(firstRequest?.query ?? '')
    resetDraft()
  }

  return (
    <aside className="rounded border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold">Page-aware panel editor</div>
        <div className="text-xs text-gray-500">{instance.originId}</div>
        {draftPanel && <div className="text-xs text-amber-600 mt-1">Draft unsaved</div>}
      </div>
      <form
        className="space-y-3 text-xs"
        onSubmit={(event) => {
          event.preventDefault()
          void handleApply()
        }}
      >
        <label className="block">
          <span className="mb-1 block font-medium text-gray-600">Title</span>
          <input
            ref={titleInputRef}
            defaultValue={instance!.config.title}
            className="w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-600">Query id</span>
          <input
            ref={queryInputRef}
            defaultValue={String(firstRequest?.query ?? '')}
            className="w-full rounded border border-gray-300 px-2 py-1 font-mono"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-white">Apply</button>
          <button type="button" className="rounded border border-gray-300 px-3 py-1.5" onClick={() => void handlePreview()}>Preview</button>
          <button type="button" className="rounded border border-gray-300 px-3 py-1.5" onClick={handleCancel}>Cancel</button>
        </div>
        {previewMeta && <pre className="max-h-44 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600">{previewMeta}</pre>}
      </form>
    </aside>
  )
}
