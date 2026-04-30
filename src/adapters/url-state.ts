import type {
  DashboardStatePatch,
  DashboardStateSnapshot,
  DashboardStateStore,
  DashboardStateWriteOptions,
} from '../schema'

export interface UrlDashboardStateStoreAdapter {
  getSearch(): string
  setSearch(search: string, options?: DashboardStateWriteOptions): void
  subscribe?(listener: () => void): () => void
}

export interface UrlDashboardStateStoreOptions {
  adapter: UrlDashboardStateStoreAdapter
  variablePrefix?: string
  fromParam?: string
  toParam?: string
  refreshParam?: string
}

export interface BrowserDashboardStateStoreOptions
  extends Omit<UrlDashboardStateStoreOptions, 'adapter'> {
  writeMode?: 'replace' | 'push'
}

interface UrlKeys {
  variablePrefix: string
  fromParam: string
  toParam: string
  refreshParam: string
}

function urlKeys(options: UrlDashboardStateStoreOptions): UrlKeys {
  return {
    variablePrefix: options.variablePrefix ?? 'var-',
    fromParam: options.fromParam ?? 'from',
    toParam: options.toParam ?? 'to',
    refreshParam: options.refreshParam ?? 'refresh',
  }
}

function normalizeSearch(search: string): string {
  return search.startsWith('?') ? search.slice(1) : search
}

function parseUrlSnapshot(search: string, keys: UrlKeys): DashboardStateSnapshot {
  const params = new URLSearchParams(normalizeSearch(search))
  const variables: Record<string, string | string[]> = {}

  const variableNames = new Set<string>()
  params.forEach((_value, key) => {
    if (key.startsWith(keys.variablePrefix)) {
      variableNames.add(key.slice(keys.variablePrefix.length))
    }
  })

  for (const name of variableNames) {
    const values = params.getAll(`${keys.variablePrefix}${name}`)
    if (values.length === 1) {
      variables[name] = values[0]!
    } else if (values.length > 1) {
      variables[name] = values
    }
  }

  const from = params.get(keys.fromParam)
  const to = params.get(keys.toParam)
  const refresh = params.get(keys.refreshParam)

  return {
    variables,
    ...(from !== null && to !== null ? { timeRange: { from, to } } : {}),
    ...(refresh !== null ? { refresh } : {}),
  }
}

function deleteDashboardParams(params: URLSearchParams, keys: UrlKeys) {
  params.delete(keys.fromParam)
  params.delete(keys.toParam)
  params.delete(keys.refreshParam)
  const paramsToDelete: string[] = []
  params.forEach((_value, key) => {
    if (key.startsWith(keys.variablePrefix)) paramsToDelete.push(key)
  })
  for (const key of paramsToDelete) params.delete(key)
}

function writeSnapshotToParams(
  params: URLSearchParams,
  snapshot: DashboardStateSnapshot,
  keys: UrlKeys,
) {
  // Only dashboard-owned params are rewritten. Other app/router params, such as
  // tab, auth handoff, or embed state, remain untouched because this is a
  // headless adapter rather than the owner of the full URL.
  deleteDashboardParams(params, keys)

  for (const [name, value] of Object.entries(snapshot.variables)) {
    const key = `${keys.variablePrefix}${name}`
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else {
      params.set(key, value)
    }
  }

  if (snapshot.timeRange) {
    params.set(keys.fromParam, snapshot.timeRange.from)
    params.set(keys.toParam, snapshot.timeRange.to)
  }

  if (snapshot.refresh !== undefined) {
    params.set(keys.refreshParam, snapshot.refresh)
  }
}

function applyPatch(
  snapshot: DashboardStateSnapshot,
  patch: DashboardStatePatch,
  options?: DashboardStateWriteOptions,
): DashboardStateSnapshot {
  // Patch the dashboard slice only. Unknown variable keys remain part of the
  // canonical URL/state until their owner removes them or replace mode is used.
  const variables = options?.replace ? {} : { ...snapshot.variables }

  if (patch.variables) {
    for (const [name, value] of Object.entries(patch.variables)) {
      if (value === undefined) {
        delete variables[name]
      } else {
        variables[name] = value
      }
    }
  }

  const nextTimeRange = patch.timeRange ?? (!options?.replace ? snapshot.timeRange : undefined)
  const nextRefresh = patch.refresh ?? (!options?.replace ? snapshot.refresh : undefined)

  return {
    variables,
    ...(nextTimeRange !== undefined ? { timeRange: nextTimeRange } : {}),
    ...(nextRefresh !== undefined ? { refresh: nextRefresh } : {}),
  }
}

export function createUrlQueryDashboardStateStore(
  options: UrlDashboardStateStoreOptions,
): DashboardStateStore {
  const keys = urlKeys(options)
  const listeners = new Set<(snapshot: DashboardStateSnapshot) => void>()

  function snapshot() {
    return parseUrlSnapshot(options.adapter.getSearch(), keys)
  }

  function emit() {
    const next = snapshot()
    listeners.forEach((listener) => listener(next))
  }

  options.adapter.subscribe?.(emit)

  return {
    getSnapshot() {
      return snapshot()
    },

    setPatch(patch, writeOptions) {
      const params = new URLSearchParams(normalizeSearch(options.adapter.getSearch()))
      const next = applyPatch(snapshot(), patch, writeOptions)
      writeSnapshotToParams(params, next, keys)
      const search = params.toString()
      options.adapter.setSearch(search ? `?${search}` : '', writeOptions)
      emit()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const createUrlDashboardStateStore = createUrlQueryDashboardStateStore

export function createBrowserDashboardStateStore(
  options: BrowserDashboardStateStoreOptions = {},
): DashboardStateStore {
  return createUrlQueryDashboardStateStore({
    ...options,
    adapter: {
      getSearch() {
        return window.location.search
      },
      setSearch(search, writeOptions) {
        const url = `${window.location.pathname}${search}${window.location.hash}`
        const mode = writeOptions?.replace || options.writeMode !== 'push'
          ? 'replaceState'
          : 'pushState'
        window.history[mode](window.history.state, '', url)
      },
      subscribe(listener) {
        window.addEventListener('popstate', listener)
        return () => window.removeEventListener('popstate', listener)
      },
    },
  })
}
