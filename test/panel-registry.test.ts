import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createPanelRegistry,
  definePanel,
} from '@dashboard-engine/core'

const viewer = () => null
const editor = () => null

const tablePanel = definePanel({
  id: 'table',
  name: 'Table',
  description: 'Tabular data',
  optionsSchema: {},
  viewer,
  editor,
  capabilities: {
    supportsRepeat: true,
  },
})

const statPanel = definePanel({
  id: 'stat',
  name: 'Stat',
  optionsSchema: {},
})

test('panel registry looks up panel plugins by type', () => {
  const registry = createPanelRegistry([tablePanel, statPanel])

  assert.equal(registry.has('table'), true)
  assert.equal(registry.has('missing'), false)
  assert.equal(registry.get('table'), tablePanel)
  assert.equal(registry.get('missing'), undefined)
  assert.deepEqual(registry.list(), [tablePanel, statPanel])
})

test('panel registry exposes optional viewer and editor components', () => {
  const registry = createPanelRegistry([tablePanel, statPanel])

  assert.equal(registry.getViewer('table'), viewer)
  assert.equal(registry.getEditor('table'), editor)
  assert.equal(registry.getViewer('stat'), undefined)
  assert.equal(registry.getEditor('missing'), undefined)
})
