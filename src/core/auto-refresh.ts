import type { CoreEngineAPI } from '../schema'

export interface AutoRefreshAddon {
  start(): void
  stop(): void
  isRunning(): boolean
}

const REFRESH_INTERVAL_MS: Record<string, number> = {
  '5s': 5_000,
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
}

function refreshToMs(refresh: string | undefined): number | null {
  if (!refresh) return null
  return REFRESH_INTERVAL_MS[refresh] ?? null
}

export function createAutoRefreshAddon(engine: CoreEngineAPI): AutoRefreshAddon {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  function clearTimer(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule(): void {
    clearTimer()
    if (!running) return

    const interval = refreshToMs(engine.getRefresh())
    if (interval === null) return

    timer = setTimeout(() => {
      timer = null
      void Promise.resolve(engine.refreshAll()).finally(schedule)
    }, interval)
  }

  engine.subscribe((event) => {
    if (event.type === 'refresh-changed') schedule()
  })

  return {
    start() {
      if (running) return
      running = true
      schedule()
    },

    stop() {
      running = false
      clearTimer()
    },

    isRunning() {
      return running && timer !== null
    },
  }
}
