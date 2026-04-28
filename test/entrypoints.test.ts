import test from 'node:test'
import assert from 'node:assert/strict'

import * as core from '../dist/index.js'
import * as react from '../dist/react.js'
import * as urlState from '../dist/url-state.js'

test('root entrypoint stays headless', () => {
  assert.equal('createDashboardEngine' in core, true)
  assert.equal('createMemoryDashboardStateStore' in core, true)
  assert.equal('useDashboard' in core, false)
  assert.equal('DashboardGrid' in core, false)
  assert.equal('createBrowserDashboardStateStore' in core, false)
})

test('react and url-state entrypoints expose adapter APIs', () => {
  assert.equal('useDashboard' in react, true)
  assert.equal('DashboardGrid' in react, true)
  assert.equal('createUrlQueryDashboardStateStore' in urlState, true)
  assert.equal('createBrowserDashboardStateStore' in urlState, true)
})
