import type {
  DatasourceContext,
  DatasourceExecutor,
  DatasourcePlugin,
  DatasourceRequest,
  DatasourceResult,
} from './types.ts'

export function defineDatasource<TOptions = Record<string, unknown>, TQuery = unknown>(
  plugin: DatasourcePlugin<TOptions, TQuery>,
): DatasourcePlugin<TOptions, TQuery> {
  return plugin
}

export function createDatasourceExecutor(
  plugins: readonly DatasourcePlugin[],
): DatasourceExecutor {
  const byUid = new Map(plugins.map((p) => [p.uid, p]))

  function get(uid: string): DatasourcePlugin {
    const plugin = byUid.get(uid)
    if (!plugin) throw new Error(`datasource "${uid}" not found`)
    return plugin
  }

  return {
    async query(request: DatasourceRequest, context: DatasourceContext = {}): Promise<DatasourceResult> {
      const plugin = get(request.uid)
      return plugin.queryData(request, context)
    },

    subscribe(request, context, onData, onError) {
      const plugin = byUid.get(request.uid)
      if (!plugin?.subscribeData) return null
      return plugin.subscribeData(request, context, onData, onError)
    },
  }
}
