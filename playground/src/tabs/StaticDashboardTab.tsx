import { useState } from 'react'
import { createDashboardEngine, definePanel } from '@loykin/dashboardkit'
import { DashboardGrid, useLoadDashboard } from '@loykin/dashboardkit/react'
import type { DashboardInput } from '@loykin/dashboardkit'
import type { PanelRenderProps } from '@loykin/dashboardkit/react'

const runbookPanel = definePanel({
  id: 'runbook',
  name: 'Runbook',
  optionsSchema: {
    body: { type: 'string', label: 'Body' },
  },
  transform() {
    return null
  },
})

const checklistPanel = definePanel({
  id: 'checklist',
  name: 'Checklist',
  optionsSchema: {
    items: { type: 'array', label: 'Items' },
  },
  transform() {
    return null
  },
})

const manualMetricPanel = definePanel({
  id: 'manual-metric',
  name: 'Manual Metric',
  optionsSchema: {
    label: { type: 'string', label: 'Label' },
    value: { type: 'string', label: 'Value' },
    detail: { type: 'string', label: 'Detail' },
  },
  transform() {
    return null
  },
})

const linksPanel = definePanel({
  id: 'links',
  name: 'Links',
  optionsSchema: {
    links: { type: 'array', label: 'Links' },
  },
  transform() {
    return null
  },
})

const engine = createDashboardEngine({
  panels: [runbookPanel, checklistPanel, manualMetricPanel, linksPanel],
  variableTypes: [],
})

const DASHBOARD: DashboardInput = {
  schemaVersion: 1,
  id: 'no-datasource-dashboard',
  title: 'Release Room',
  layout: { cols: 12, rowHeight: 44 },
  panels: [
    {
      id: 'summary',
      type: 'runbook',
      title: 'Release summary',
      gridPos: { x: 0, y: 0, w: 7, h: 4 },
      options: {
        body: [
          'Version: dashboardkit 0.0.0-dev',
          'Owner: Platform UI',
          'Window: 14:00-15:00 KST',
          'Scope: package boundary cleanup, docs, playground verification',
        ].join('\n'),
      },
    },
    {
      id: 'status',
      type: 'manual-metric',
      title: 'Manual status',
      gridPos: { x: 7, y: 0, w: 5, h: 4 },
      options: {
        label: 'Datasource calls',
        value: '0',
        detail: 'This dashboard registers no datasource plugins.',
      },
    },
    {
      id: 'checklist',
      type: 'checklist',
      title: 'Ship checklist',
      gridPos: { x: 0, y: 4, w: 7, h: 5 },
      options: {
        items: [
          'Typecheck root package',
          'Build playground',
          'Run test suite',
          'Verify DatasourceKit tab',
        ],
      },
    },
    {
      id: 'links',
      type: 'links',
      title: 'App-owned links',
      gridPos: { x: 7, y: 4, w: 5, h: 5 },
      options: {
        links: [
          { label: 'DatasourceKit example', href: '/playground/datasourcekit' },
          { label: 'Full dashboard', href: '/dashboard/sales' },
          { label: 'Builder lifecycle', href: '/playground/navigation-lifecycle' },
        ],
      },
    },
  ],
}

function optionArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function RunbookPanel({ props }: { props: PanelRenderProps }) {
  const lines = String(props.options['body'] ?? '').split('\n')
  return (
    <section ref={props.ref} className="h-full rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{props.config.title}</h2>
      <dl className="mt-3 grid gap-2 text-sm">
        {lines.map((line) => {
          const [key, ...rest] = line.split(':')
          return (
            <div key={line} className="grid grid-cols-[96px_1fr] gap-3">
              <dt className="text-gray-500">{key}</dt>
              <dd className="font-medium text-gray-900">{rest.join(':').trim()}</dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function ManualMetricPanel({ props }: { props: PanelRenderProps }) {
  return (
    <section ref={props.ref} className="h-full rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
        {String(props.options['label'] ?? '')}
      </p>
      <p className="mt-2 text-5xl font-semibold text-emerald-950">{String(props.options['value'] ?? '')}</p>
      <p className="mt-3 text-sm text-emerald-900">{String(props.options['detail'] ?? '')}</p>
    </section>
  )
}

function ChecklistPanel({ props }: { props: PanelRenderProps }) {
  const items = optionArray(props.options['items']).map(String)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const done = items.filter((item) => checked[item]).length

  return (
    <section ref={props.ref} className="h-full rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{props.config.title}</h2>
        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-mono text-gray-600">
          {done}/{items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <label key={item} className="flex items-center gap-2 rounded border border-gray-100 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={checked[item] ?? false}
              onChange={(event) => setChecked((prev) => ({ ...prev, [item]: event.target.checked }))}
            />
            <span className={checked[item] ? 'text-gray-400 line-through' : 'text-gray-800'}>{item}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function LinksPanel({ props }: { props: PanelRenderProps }) {
  const links = optionArray(props.options['links']) as Array<{ label?: unknown; href?: unknown }>
  return (
    <section ref={props.ref} className="h-full rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{props.config.title}</h2>
      <div className="mt-3 space-y-2">
        {links.map((link) => (
          <a
            key={String(link.href)}
            className="block rounded border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
            href={String(link.href ?? '#')}
          >
            {String(link.label ?? link.href ?? '')}
          </a>
        ))}
      </div>
    </section>
  )
}

function renderPanel(props: PanelRenderProps) {
  if (props.panelType === 'runbook') return <RunbookPanel props={props} />
  if (props.panelType === 'manual-metric') return <ManualMetricPanel props={props} />
  if (props.panelType === 'checklist') return <ChecklistPanel props={props} />
  if (props.panelType === 'links') return <LinksPanel props={props} />
  return null
}

export function StaticDashboardTab() {
  useLoadDashboard(engine, DASHBOARD)

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-bold">No Datasource Dashboard</h1>
      <p className="mb-6 text-sm text-gray-500">
        A dashboard can be a workspace for app-owned content: runbooks, checklists, links, embeds, and manual state.
      </p>

      <DashboardGrid engine={engine} width={960}>
        {renderPanel}
      </DashboardGrid>
    </div>
  )
}
