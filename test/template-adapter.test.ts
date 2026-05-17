import test from 'node:test'
import assert from 'node:assert/strict'

import {
  builtinVariableTypes,
  createDashboardEngine,
} from '@loykin/dashboardkit'
import type { RefParseResult, TemplateAdapter } from '@loykin/dashboardkit'
import { defineDatasource } from './helpers.ts'

const mustacheTemplateAdapter: TemplateAdapter = {
  parseRefs(template: string): RefParseResult {
    const refs: string[] = []
    const re = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z]+))?\s*}}/g
    let match: RegExpExecArray | null
    while ((match = re.exec(template)) !== null) {
      refs.push(match[1]!)
    }
    return { refs: [...new Set(refs)], template }
  },
}

test('templateAdapter drives panel dependency detection and variable cascades consistently', async () => {
  const variableCalls: string[] = []
  const panelCalls: string[] = []
  const datasource = defineDatasource({
    uid: 'api',
    type: 'mock',
    variable: {
      async metricFindQuery(_query, context) {
        const country = String(context.variables['country'] ?? '')
        variableCalls.push(country)
        return [{ label: `city-${country}`, value: `city-${country}` }]
      },
    },
    async queryData(_request, context) {
      panelCalls.push(String(context.variables['country'] ?? ''))
      return { columns: [], rows: [] }
    },
  })

  const engine = createDashboardEngine({
    datasourceAdapter: datasource,
    templateAdapter: mustacheTemplateAdapter,
    variableTypes: builtinVariableTypes,
  })

  engine.load({
    schemaVersion: 1,
    id: 'template-adapter',
    title: 'Template Adapter',
    variables: [
      { name: 'country', type: 'custom', options: { values: 'KR,US' }, defaultValue: 'KR' },
      {
        name: 'city',
        type: 'query',
        dataRequest: { id: 'cities', uid: 'api', type: 'mock', query: '{{country}}' },
      },
    ],
    panels: [
      {
        id: 'p1',
        type: 'table',
        title: 'Panel',
        gridPos: { x: 0, y: 0, w: 12, h: 4 },
        dataRequests: [
          { id: 'main', uid: 'api', type: 'mock', options: { country: '{{country}}' } },
        ],
      },
    ],
  })

  await new Promise<void>((resolve) => setTimeout(resolve, 30))
  variableCalls.length = 0
  panelCalls.length = 0

  engine.setVariable('country', 'US')
  await new Promise<void>((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(variableCalls, ['US'])
  assert.deepEqual(panelCalls, ['US'])
  assert.equal(engine.getVariable('city')?.value, 'city-US')
})
