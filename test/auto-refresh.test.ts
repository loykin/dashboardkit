import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAutoRefreshAddon,
} from '@dashboard-engine/core'
import type {
  CoreEngineAPI,
  EngineEvent,
} from '@dashboard-engine/core'

function createRefreshEngine(initialRefresh = '5s') {
  let refresh = initialRefresh
  let refreshAllCalls = 0
  let listener: ((event: EngineEvent) => void) | null = null

  const engine = {
    getRefresh() {
      return refresh
    },
    async refreshAll() {
      refreshAllCalls += 1
    },
    subscribe(nextListener: (event: EngineEvent) => void) {
      listener = nextListener
      return () => {
        listener = null
      }
    },
  } as Pick<CoreEngineAPI, 'getRefresh' | 'refreshAll' | 'subscribe'>

  return {
    engine,
    get refreshAllCalls() {
      return refreshAllCalls
    },
    setRefresh(next: string) {
      refresh = next
      listener?.({ type: 'refresh-changed', refresh: next })
    },
  }
}

test('auto-refresh addon calls refreshAll at configured interval', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createRefreshEngine('5s')
  const addon = createAutoRefreshAddon(harness.engine as CoreEngineAPI)

  addon.start()
  assert.equal(addon.isRunning(), true)

  context.mock.timers.tick(4_999)
  assert.equal(harness.refreshAllCalls, 0)

  context.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(harness.refreshAllCalls, 1)
})

test('auto-refresh addon stops when refresh is disabled', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createRefreshEngine('5s')
  const addon = createAutoRefreshAddon(harness.engine as CoreEngineAPI)

  addon.start()
  harness.setRefresh('')

  context.mock.timers.tick(5_000)
  await Promise.resolve()
  assert.equal(harness.refreshAllCalls, 0)
  assert.equal(addon.isRunning(), false)
})

test('auto-refresh addon restarts when interval changes', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createRefreshEngine('5s')
  const addon = createAutoRefreshAddon(harness.engine as CoreEngineAPI)

  addon.start()
  harness.setRefresh('10s')

  context.mock.timers.tick(5_000)
  await Promise.resolve()
  assert.equal(harness.refreshAllCalls, 0)

  context.mock.timers.tick(5_000)
  await Promise.resolve()
  assert.equal(harness.refreshAllCalls, 1)
})

test('auto-refresh addon stop prevents pending ticks', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const harness = createRefreshEngine('5s')
  const addon = createAutoRefreshAddon(harness.engine as CoreEngineAPI)

  addon.start()
  addon.stop()

  context.mock.timers.tick(5_000)
  await Promise.resolve()
  assert.equal(harness.refreshAllCalls, 0)
  assert.equal(addon.isRunning(), false)
})

