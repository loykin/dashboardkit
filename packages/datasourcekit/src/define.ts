import type { DatasourcePluginDef } from './types'

export function defineDatasource<
  TOptions = Record<string, unknown>,
  TQuery = unknown,
>(
  def: DatasourcePluginDef<TOptions, TQuery>,
): DatasourcePluginDef<TOptions, TQuery> {
  return def
}
