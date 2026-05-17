import {
  createDatasourceAdapter as createCoreDatasourceAdapter,
  defineDatasource as defineCoreDatasource,
  tableRowsToQueryResult,
} from '@loykin/dashboardkit'
import type {
  DashboardDatasourceAdapter,
  DashboardDatasourceQueryContext,
  DataQuery,
  DatasourceAdapterDef,
  DatasourcePluginDef,
  QueryResult,
  TableRowsInput,
} from '@loykin/dashboardkit'

export type {
  DashboardDatasourceQueryContext,
  DataQuery,
} from '@loykin/dashboardkit'

export type TestDatasourceDef<TOptions = Record<string, unknown>, TQuery = unknown> =
  Omit<DatasourcePluginDef<TOptions, TQuery>, 'queryData' | 'subscribeData' | 'connector' | 'editor'> & {
    queryData?: (
      request: DataQuery<TQuery>,
      context: DashboardDatasourceQueryContext<TOptions>,
    ) => Promise<QueryResult | TableRowsInput>
    subscribeData?: (
      request: DataQuery<TQuery>,
      context: DashboardDatasourceQueryContext<TOptions>,
      onData: (result: QueryResult | TableRowsInput) => void,
      onError: (error: Error) => void,
    ) => () => void
    connector?: DatasourcePluginDef<TOptions, TQuery>['connector'] & {
      configSchema?: Record<string, unknown>
    }
    editor?: DatasourcePluginDef<TOptions, TQuery>['editor'] & {
      querySchema?: Record<string, unknown>
    }
  }

export type TestDatasourceAdapter<TOptions = Record<string, unknown>, TQuery = unknown> =
  DatasourceAdapterDef<TOptions, TQuery>

function normalizeQueryResult(result: QueryResult | TableRowsInput): QueryResult {
  return 'frames' in result ? result : tableRowsToQueryResult(result)
}

export function defineDatasource<TOptions = Record<string, unknown>, TQuery = unknown>(
  def: TestDatasourceDef<TOptions, TQuery>,
): TestDatasourceAdapter<TOptions, TQuery> {
  const { queryData, subscribeData, ...rest } = def
  return defineCoreDatasource<TOptions, TQuery>({
    ...rest,
    ...(queryData
      ? {
          queryData: async (request, context) =>
            normalizeQueryResult(await queryData(request, context)),
        }
      : {}),
    ...(subscribeData
      ? {
          subscribeData: (request, context, onData, onError) =>
            subscribeData(
              request,
              context,
              (result) => onData(normalizeQueryResult(result)),
              onError,
            ),
        }
      : {}),
  })
}

export function createDatasourceAdapter(
  datasources: readonly TestDatasourceAdapter[],
): DashboardDatasourceAdapter {
  return createCoreDatasourceAdapter(datasources)
}
