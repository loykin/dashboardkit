import {
  createDatasourceAdapter as createCoreDatasourceAdapter,
  defineDatasource as defineCoreDatasource,
  tableRowsToQueryResult,
} from '@loykin/dashboardkit'
import type {
  DashboardDatasourceAdapter,
  DashboardDatasourceQueryContext,
  DataQuery,
  DatasourceAdapterDef as CoreDatasourceAdapterDef,
  DatasourcePluginDef as CoreDatasourcePluginDef,
  OptionField,
  QueryResult,
  TableRowsInput,
} from '@loykin/dashboardkit'

export type {
  DashboardDatasourceQueryContext,
  DataQuery,
} from '@loykin/dashboardkit'

export interface DatasourcePluginDef<TOptions = Record<string, unknown>, TQuery = unknown>
  extends Omit<CoreDatasourcePluginDef<TOptions, TQuery>, 'queryData' | 'subscribeData' | 'connector' | 'editor'> {
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
  connector?: CoreDatasourcePluginDef<TOptions, TQuery>['connector'] & {
    configSchema?: Record<string, OptionField>
    defaultConfig?: Record<string, unknown>
    configEditor?: (props: {
      value: Record<string, unknown>
      onChange(value: Record<string, unknown>): void
    }) => unknown
  }
  editor?: CoreDatasourcePluginDef<TOptions, TQuery>['editor'] & {
    querySchema?: Record<string, OptionField>
  }
}

export type DatasourceAdapterDef<TOptions = Record<string, unknown>, TQuery = unknown> =
  CoreDatasourceAdapterDef<TOptions, TQuery> & DatasourcePluginDef<TOptions, TQuery>

function normalizeQueryResult(result: QueryResult | TableRowsInput): QueryResult {
  return 'frames' in result ? result : tableRowsToQueryResult(result)
}

export function defineDatasource<TOptions = Record<string, unknown>, TQuery = unknown>(
  def: DatasourcePluginDef<TOptions, TQuery>,
): DatasourceAdapterDef<TOptions, TQuery> {
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
  }) as DatasourceAdapterDef<TOptions, TQuery>
}

export function createDatasourceAdapter(
  datasources: readonly DatasourceAdapterDef[],
): DashboardDatasourceAdapter {
  return createCoreDatasourceAdapter(datasources)
}
