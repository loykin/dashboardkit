/**
 * datasourcekit ↔ dashboardkit bridge validation
 *
 * 이 테스트가 증명하는 것:
 * 1. datasourcekit은 dashboardkit을 전혀 import하지 않는다
 * 2. bridge는 얇다 — 컨텍스트 field 매핑 + format 변환만 한다
 * 3. 같은 executor를 dashboard 없이 standalone으로도 쓸 수 있다
 * 4. DashboardDatasourceAdapter 인터페이스가 외부 구현으로 충분히 채워진다
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createDatasourceExecutor, defineDatasource } from '@loykin/datasourcekit'
import type { DatasourceContext, DatasourceExecutor, DatasourceRequest } from '@loykin/datasourcekit'

import { createDashboardEngine, definePanel, tableRowsToQueryResult } from '@loykin/dashboardkit'
import type { DashboardDatasourceAdapter, DashboardDatasourceContext } from '@loykin/dashboardkit'

// ─── bridge ────────────────────────────────────────────────────────────────────
// DashboardDatasourceContext → DatasourceContext: dashboard 전용 필드는 버림
// DatasourceResult → QueryResult: format 변환은 bridge 책임
function toDashboardAdapter(executor: DatasourceExecutor): DashboardDatasourceAdapter {
  function toKitCtx(ctx: DashboardDatasourceContext): DatasourceContext {
    return {
      ...(ctx.timeRange !== undefined ? { timeRange: ctx.timeRange } : {}),
      variables: ctx.variables,
      ...(ctx.authContext !== undefined ? { authContext: ctx.authContext } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    }
  }

  function toKitReq(req: { uid: string; type?: string; query?: unknown; options?: Record<string, unknown> }): DatasourceRequest {
    return {
      uid: req.uid,
      ...(req.type !== undefined ? { type: req.type } : {}),
      ...(req.query !== undefined ? { query: req.query } : {}),
      ...(req.options !== undefined ? { options: req.options } : {}),
    }
  }

  return {
    async query(request, context) {
      const result = await executor.query(toKitReq(request), toKitCtx(context))
      return tableRowsToQueryResult(result)
    },
    subscribe(request, context, onData, onError) {
      return executor.subscribe(
        toKitReq(request),
        toKitCtx(context),
        (result) => onData(tableRowsToQueryResult(result)),
        onError,
      )
    },
  }
}

// ─── fixture ──────────────────────────────────────────────────────────────────
const panel = definePanel({ id: 'table', name: 'Table', optionsSchema: {} })

// ─── tests ────────────────────────────────────────────────────────────────────

test('datasourcekit: standalone query without dashboard', async () => {
  const kit = createDatasourceExecutor([
    defineDatasource({
      uid: 'myapi',
      type: 'backend',
      async queryData(_request, context) {
        return {
          columns: [{ name: 'region' }, { name: 'count' }],
          rows: [[context.variables?.['region'] ?? 'default', 42]],
        }
      },
    }),
  ])

  const result = await kit.query(
    { uid: 'myapi', query: 'SELECT count FROM orders' },
    { variables: { region: 'KR' } },
  )

  assert.equal(result.rows[0]?.[0], 'KR')
  assert.equal(result.rows[0]?.[1], 42)
})

test('datasourcekit: bridge connects to dashboardkit engine', async () => {
  const seen: { uid: string; variables: Record<string, string | string[]> }[] = []

  const kit = createDatasourceExecutor([
    defineDatasource({
      uid: 'myapi',
      type: 'backend',
      async queryData(request, context) {
        seen.push({ uid: request.uid, variables: context.variables ?? {} })
        return { columns: [{ name: 'value' }], rows: [[1]] }
      },
    }),
  ])

  const engine = createDashboardEngine({
    panels: [panel],
    variableTypes: [],
    datasourceAdapter: toDashboardAdapter(kit),
  })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [{
      id: 'p1', type: 'table',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataRequests: [{ id: 'main', uid: 'myapi', type: 'backend', query: 'SELECT 1' }],
    }],
  })

  await new Promise<void>((r) => setTimeout(r, 50))

  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.uid, 'myapi')
})

test('datasourcekit: timeRange and variables flow through bridge, dashboard fields do not', async () => {
  let capturedCtx: DatasourceContext | undefined

  const kit = createDatasourceExecutor([
    defineDatasource({
      uid: 'ts',
      type: 'timeseries',
      async queryData(_request, context) {
        capturedCtx = context
        return { columns: [], rows: [] }
      },
    }),
  ])

  const engine = createDashboardEngine({
    panels: [panel],
    variableTypes: [],
    datasourceAdapter: toDashboardAdapter(kit),
  })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    timeRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
    variables: [],
    panels: [{
      id: 'p1', type: 'table',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataRequests: [{ id: 'main', uid: 'ts', type: 'timeseries' }],
    }],
  })

  await new Promise<void>((r) => setTimeout(r, 50))

  assert.ok(capturedCtx, 'queryData should have been called')
  assert.equal(capturedCtx.timeRange?.from, '2026-01-01T00:00:00.000Z')
  // dashboardId, panelId 같은 dashboard 전용 필드는 datasourcekit context에 없다
  assert.equal('dashboardId' in capturedCtx, false)
  assert.equal('panelId' in capturedCtx, false)
  assert.equal('builtins' in capturedCtx, false)
})

test('datasourcekit: same executor reused standalone after dashboard query', async () => {
  const callLog: string[] = []

  const kit = createDatasourceExecutor([
    defineDatasource({
      uid: 'dual',
      type: 'backend',
      async queryData(_request, context) {
        callLog.push(context.variables?.['source'] as string ?? 'none')
        return { columns: [{ name: 'ok' }], rows: [[true]] }
      },
    }),
  ])

  const engine = createDashboardEngine({
    panels: [panel],
    variableTypes: [],
    datasourceAdapter: toDashboardAdapter(kit),
  })

  engine.load({
    schemaVersion: 1, id: 'd', title: 'D',
    variables: [],
    panels: [{
      id: 'p1', type: 'table',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      dataRequests: [{ id: 'main', uid: 'dual', type: 'backend' }],
    }],
  })
  await new Promise<void>((r) => setTimeout(r, 50))

  // 같은 executor를 dashboard 없이 standalone으로 재사용 (alert, report job 등)
  const result = await kit.query(
    { uid: 'dual' },
    { variables: { source: 'alert-job' } },
  )

  assert.equal(callLog.at(-1), 'alert-job')
  assert.equal(result.rows[0]?.[0], true)
})
