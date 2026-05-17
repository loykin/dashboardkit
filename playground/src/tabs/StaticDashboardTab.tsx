import React, { useState } from 'react'
import { createDashboardEngine, definePanel } from '@loykin/dashboardkit'
import { DashboardGrid, useLoadDashboard } from '@loykin/dashboardkit/react'
import type { DashboardInput, PanelViewerProps } from '@loykin/dashboardkit'
import type { PanelRenderProps } from '@loykin/dashboardkit/react'

function optionArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const runbookPanel = definePanel({
  id: 'runbook',
  name: 'Runbook',
  optionsSchema: {
    body: { type: 'string', label: 'Body' },
  },
  transform() {
    return null
  },
  viewer({ options, panel }: PanelViewerProps<{ body?: string }, null>) {
    const lines = String(options['body'] ?? '').split('\n')
    return (
      <section className="h-full rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{panel.title}</h2>
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
  viewer({ options, panel }: PanelViewerProps<{ items?: unknown[] }, null>) {
    const items = optionArray(options['items']).map(String)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [checked, setChecked] = useState<Record<string, boolean>>({})
    const done = items.filter((item) => checked[item]).length
    return (
      <section className="h-full rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{panel.title}</h2>
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
  viewer({ options }: PanelViewerProps<{ label?: string; value?: string; detail?: string }, null>) {
    return (
      <section className="h-full rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          {String(options['label'] ?? '')}
        </p>
        <p className="mt-2 text-5xl font-semibold text-emerald-950">{String(options['value'] ?? '')}</p>
        <p className="mt-3 text-sm text-emerald-900">{String(options['detail'] ?? '')}</p>
      </section>
    )
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
  viewer({ options, panel }: PanelViewerProps<{ links?: unknown[] }, null>) {
    const links = optionArray(options['links']) as Array<{ label?: unknown; href?: unknown }>
    return (
      <section className="h-full rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">{panel.title}</h2>
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
        detail: 'This dashboard configures no datasource adapter.',
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
          { label: 'Datasource adapter demo', href: '/playground/annotations' },
          { label: 'Full dashboard', href: '/dashboard/sales' },
          { label: 'Builder lifecycle', href: '/playground/navigation-lifecycle' },
        ],
      },
    },
  ],
}

function renderPanel(engine: ReturnType<typeof createDashboardEngine>, props: PanelRenderProps) {
  const Viewer = engine.getPanelPlugin(props.panelType)?.viewer as ((props: PanelViewerProps<unknown, unknown>) => React.ReactNode) | undefined
  if (Viewer) {
    return <Viewer data={props.data} loading={props.loading} error={props.error} options={props.options} panel={props.config} variables={{}} width={0} height={0} rawData={props.rawData} />
  }
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
        {(props) => renderPanel(engine, props)}
      </DashboardGrid>
    </div>
  )
}
