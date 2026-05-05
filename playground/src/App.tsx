import { Navigate, Outlet, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  DashboardAppProvider,
  DashboardAbortLayout,
  DashboardPage,
  PanelEditorPage,
  VariablesPage,
  DatasourceListPage,
  DatasourceEditPage,
} from '@/demo/DashboardDemo'
import { ParseRefsTab } from './tabs/ParseRefsTab'
import { InterpolateTab } from './tabs/InterpolateTab'
import { FormatTab } from './tabs/FormatTab'
import { DagTab } from './tabs/DagTab'
import { BuiltinsTab } from './tabs/BuiltinsTab'
import { DashboardDemoTab } from './tabs/DashboardDemoTab'
import { AuthorizationTab } from './tabs/AuthorizationTab'
import { UrlStateTab } from './tabs/UrlStateTab'
import { GrafanaStyleTab } from './tabs/GrafanaStyleTab'
import { SupersetStyleTab } from './tabs/SupersetStyleTab'
import { NavigationLifecycleTab } from './tabs/NavigationLifecycleTab'
import { TransformsTab } from './tabs/TransformsTab'
import { CsvExportTab } from './tabs/CsvExportTab'
import { StreamingTab } from './tabs/StreamingTab'
import { CacheTtlTab } from './tabs/CacheTtlTab'
import { AnnotationsTab } from './tabs/AnnotationsTab'
import { StaticDashboardTab } from './tabs/StaticDashboardTab'
import { DatasourceKitTab } from './tabs/DatasourceKitTab'

// ── Navigation tree ────────────────────────────────────────────────────────────

interface NavItem {
  id: string
  label: string
  path: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: 'Demo',
    items: [
      { id: 'full-dashboard',       label: 'Full Dashboard',       path: '/dashboard/sales' },
      { id: 'grafana-style',        label: 'Operations Viewer',    path: '/playground/grafana-style' },
      { id: 'superset-style',       label: 'Explore Cross-filter', path: '/playground/superset-style' },
      { id: 'dashboard',            label: 'Grid Basics',          path: '/playground/dashboard' },
      { id: 'static-dashboard',     label: 'No Datasource',        path: '/playground/static-dashboard' },
    ],
  },
  {
    label: 'Engine',
    items: [
      { id: 'transforms',           label: 'Transforms',           path: '/playground/transforms' },
      { id: 'streaming',            label: 'Streaming',            path: '/playground/streaming' },
      { id: 'cache-ttl',            label: 'Cache TTL',            path: '/playground/cache-ttl' },
      { id: 'datasourcekit',        label: 'DatasourceKit',        path: '/playground/datasourcekit' },
      { id: 'annotations',          label: 'Annotations',          path: '/playground/annotations' },
      { id: 'authorization',        label: 'Authorization',        path: '/playground/authorization' },
      { id: 'navigation-lifecycle', label: 'Builder Lifecycle',    path: '/playground/navigation-lifecycle' },
    ],
  },
  {
    label: 'Query & Variables',
    items: [
      { id: 'interpolate',          label: 'interpolate()',        path: '/playground/interpolate' },
      { id: 'parse-refs',           label: 'parseRefs()',          path: '/playground/parse-refs' },
      { id: 'format',               label: 'Format Specifiers',    path: '/playground/format' },
      { id: 'builtins',             label: 'Built-ins',            path: '/playground/builtins' },
      { id: 'url-state',            label: 'URL State',            path: '/playground/url-state' },
      { id: 'csv-export',           label: 'CSV Export',           path: '/playground/csv-export' },
    ],
  },
  {
    label: 'Internals',
    items: [
      { id: 'dag',                  label: 'DAG',                  path: '/playground/dag' },
    ],
  },
]

// ── Sidebar ────────────────────────────────────────────────────────────────────

function Sidebar() {
  const nav = useNavigate()
  const { pathname } = useLocation()

  return (
    <aside className="w-56 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="px-5 py-4">
        <p className="text-sm font-semibold tracking-tight">DashboardKit</p>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">@loykin/dashboardkit</p>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav className="px-3 py-4 space-y-5">
          {NAV.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.path || pathname.startsWith(item.path + '/')
                  return (
                    <button
                      key={item.id}
                      onClick={() => nav(item.path)}
                      className={cn(
                        'w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  )
}

// ── Shell — sidebar always visible ────────────────────────────────────────────

function Shell() {
  const { pathname } = useLocation()
  const isDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/datasources')

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className={cn('flex-1 min-w-0', isDashboard ? 'overflow-hidden' : 'overflow-auto px-8 py-6')}>
        <Outlet />
      </main>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/playground/transforms" replace />} />

      <Route element={<Shell />}>
        {/* Dashboard section — no padding, fills content area */}
        <Route element={<DashboardAppProvider />}>
          <Route element={<DashboardAbortLayout />}>
            <Route path="/dashboard/:dashboardId" element={<DashboardPage />} />
            <Route path="/dashboard/:dashboardId/panels/:panelId/edit" element={<PanelEditorPage />} />
            <Route path="/dashboard/:dashboardId/variables" element={<VariablesPage />} />
          </Route>
          <Route path="/datasources" element={<DatasourceListPage />} />
          <Route path="/datasources/new" element={<DatasourceEditPage />} />
          <Route path="/datasources/:uid/edit" element={<DatasourceEditPage />} />
        </Route>

        {/* Playground tabs — with padding */}
        <Route path="/playground/grafana-style"        element={<GrafanaStyleTab />} />
        <Route path="/playground/superset-style"       element={<SupersetStyleTab />} />
        <Route path="/playground/dashboard"            element={<DashboardDemoTab />} />
        <Route path="/playground/static-dashboard"     element={<StaticDashboardTab />} />
        <Route path="/playground/transforms"           element={<TransformsTab />} />
        <Route path="/playground/streaming"            element={<StreamingTab />} />
        <Route path="/playground/cache-ttl"            element={<CacheTtlTab />} />
        <Route path="/playground/datasourcekit"        element={<DatasourceKitTab />} />
        <Route path="/playground/annotations"          element={<AnnotationsTab />} />
        <Route path="/playground/authorization"        element={<AuthorizationTab />} />
        <Route path="/playground/navigation-lifecycle" element={<NavigationLifecycleTab />} />
        <Route path="/playground/interpolate"          element={<InterpolateTab />} />
        <Route path="/playground/parse-refs"           element={<ParseRefsTab />} />
        <Route path="/playground/format"               element={<FormatTab />} />
        <Route path="/playground/builtins"             element={<BuiltinsTab />} />
        <Route path="/playground/url-state"            element={<UrlStateTab />} />
        <Route path="/playground/csv-export"           element={<CsvExportTab />} />
        <Route path="/playground/dag"                  element={<DagTab />} />
      </Route>

      <Route path="*" element={<Navigate to="/playground/transforms" replace />} />
    </Routes>
  )
}
