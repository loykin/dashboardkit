import { useEffect, useState } from 'react'
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

const TABS = [
  { id: 'navigation-lifecycle', label: 'Builder Lifecycle', content: <NavigationLifecycleTab /> },
  { id: 'grafana-style', label: 'Operations Viewer', content: <GrafanaStyleTab /> },
  { id: 'superset-style', label: 'Explore Cross-filter', content: <SupersetStyleTab /> },
  { id: 'dashboard', label: 'Grid Basics', content: <DashboardDemoTab /> },
  { id: 'authorization', label: 'Authorization', content: <AuthorizationTab /> },
  { id: 'url-state', label: 'URL State', content: <UrlStateTab /> },
  { id: 'parse-refs', label: 'parseRefs()', content: <ParseRefsTab /> },
  { id: 'interpolate', label: 'interpolate()', content: <InterpolateTab /> },
  { id: 'format', label: 'Format Specifiers', content: <FormatTab /> },
  { id: 'dag', label: 'DAG', content: <DagTab /> },
  { id: 'builtins', label: 'Built-ins', content: <BuiltinsTab /> },
] as const

type TabId = (typeof TABS)[number]['id']

function tabFromSearch(): TabId {
  const tab = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((item) => item.id === tab) ? tab as TabId : 'navigation-lifecycle'
}

export default function App() {
  const [active, setActive] = useState<TabId>(() => tabFromSearch())
  const current = TABS.find((t) => t.id === active)!

  useEffect(() => {
    const sync = () => setActive(tabFromSearch())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  function selectTab(tab: TabId) {
    setActive(tab)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', tab)
    const search = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${search}`)
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* Header */}
      <div className="border-b border-gray-200 px-8 py-3">
        <h1 className="text-lg font-semibold">Dashboard Engine Playground</h1>
        <p className="text-xs text-gray-400 mt-0.5">@dashboard-engine/core</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 px-8">
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                active === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-6">{current.content}</div>
    </div>
  )
}
