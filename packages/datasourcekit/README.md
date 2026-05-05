# @loykin/datasourcekit

DatasourceKit is a dashboard-independent datasource registry and execution
layer. It is intended for dashboards, alerts, reports, query previews, schema
browsers, backend jobs, and any runtime that needs the same datasource plugin
contract without depending on DashboardKit.

## Install

```bash
pnpm add @loykin/datasourcekit
```

## Core Contract

DatasourceKit executes `DataQuery` jobs with optional `QueryContext`. Dashboard,
panel, and layout concepts are not part of the core API. Apps that need tracing
or product-specific context can pass it through `context.meta`.

```ts
import { createDatasourceExecutor, defineDatasource } from '@loykin/datasourcekit'

const datasource = defineDatasource({
  uid: 'main-api',
  type: 'http',
  options: { baseUrl: 'https://api.example.com' },

  async queryData(request, context) {
    const res = await fetch(`${context.datasourceOptions.baseUrl}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: request.query,
        options: request.options,
        variables: context.variables,
        timeRange: context.timeRange,
      }),
      signal: context.signal,
    })

    return res.json()
  },
})

const executor = createDatasourceExecutor({ datasources: [datasource] })

const result = await executor.query(
  {
    id: 'orders',
    datasourceUid: 'main-api',
    datasourceType: 'http',
    query: 'orders.list',
    options: { country: 'KR' },
  },
  {
    variables: { env: 'prod' },
    timeRange: { from: 'now-1h', to: 'now' },
    meta: { source: 'report', reportId: 'daily-sales' },
  },
)
```

## Plugin Capabilities

Datasource plugins expose capabilities explicitly:

- `queryData` for one-shot query execution
- `subscribeData` for streaming query execution
- `variable.metricFindQuery` for query variable options
- `schema.listNamespaces` and `schema.listFields` for schema browsing
- `connector.healthCheck` for datasource health checks
- `editor.validateQuery` for query editor validation
- `annotations.queryAnnotations` for annotation lookup

Missing capabilities fail through `DatasourceCapabilityError`. This package
does not expose the DashboardKit-style query options signature.

## Authorization

Use the executor `authorize` hook to enforce datasource-level policy across
products.

```ts
const executor = createDatasourceExecutor({
  datasources: [datasource],
  authorize(request) {
    if (request.action === 'datasource:query') {
      return { allowed: request.context.authContext?.subject?.roles?.includes('reader') ?? false }
    }
    return true
  },
})
```

## Monorepo Status

DatasourceKit is developed as a workspace package in this repository first. It
should become a separate repository only when it needs an independent release
cycle, external datasource plugin ecosystem, or clear non-DashboardKit consumers.
