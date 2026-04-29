import type {
  DashboardStatePatch,
  DashboardStateSnapshot,
  DashboardStateStore,
  DashboardStateWriteOptions,
} from './types'

function cloneSnapshot(snapshot: DashboardStateSnapshot): DashboardStateSnapshot {
  return {
    variables: { ...snapshot.variables },
    ...(snapshot.timeRange ? { timeRange: { ...snapshot.timeRange } } : {}),
    ...(snapshot.refresh !== undefined ? { refresh: snapshot.refresh } : {}),
  }
}

export function createMemoryDashboardStateStore(
  initialSnapshot: Partial<DashboardStateSnapshot> = {},
): DashboardStateStore {
  let snapshot: DashboardStateSnapshot = {
    variables: { ...(initialSnapshot.variables ?? {}) },
    ...(initialSnapshot.timeRange ? { timeRange: { ...initialSnapshot.timeRange } } : {}),
    ...(initialSnapshot.refresh !== undefined ? { refresh: initialSnapshot.refresh } : {}),
  }
  const listeners = new Set<(snapshot: DashboardStateSnapshot) => void>()

  function emit() {
    const next = cloneSnapshot(snapshot)
    listeners.forEach((listener) => listener(next))
  }

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot)
    },

    setPatch(patch: DashboardStatePatch, options?: DashboardStateWriteOptions) {
      if (options?.replace) {
        snapshot = { variables: {} }
      }

      // Patch semantics are intentional: dashboard state is canonical, but
      // callers only mutate the keys they own. Unknown variables are preserved
      // unless explicitly set to undefined or replace mode is requested.
      const nextVariables = options?.replace
        ? {}
        : { ...snapshot.variables }

      if (patch.variables) {
        for (const [name, value] of Object.entries(patch.variables)) {
          if (value === undefined) {
            delete nextVariables[name]
          } else {
            nextVariables[name] = value
          }
        }
      }

      const nextTimeRange = patch.timeRange ?? (!options?.replace ? snapshot.timeRange : undefined)
      const nextRefresh = patch.refresh ?? (!options?.replace ? snapshot.refresh : undefined)

      snapshot = {
        variables: nextVariables,
        ...(nextTimeRange !== undefined ? { timeRange: nextTimeRange } : {}),
        ...(nextRefresh !== undefined ? { refresh: nextRefresh } : {}),
      }

      emit()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
