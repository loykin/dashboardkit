import type { DataRequestConfig } from '../schema'
import type { DatasourcePluginDef } from '../schema'
import { DatasourceNotFoundError, DatasourceTypeMismatchError } from './errors'

export interface DatasourceRegistry {
  get(uid: string): DatasourcePluginDef | undefined
  getForRequest(request: DataRequestConfig): DatasourcePluginDef
  list(): DatasourcePluginDef[]
  has(uid: string): boolean
  toRecord(): Record<string, DatasourcePluginDef>
}

export function createDatasourceRegistry(
  plugins: readonly DatasourcePluginDef[],
): DatasourceRegistry {
  const byUid = new Map<string, DatasourcePluginDef>()

  for (const plugin of plugins) {
    byUid.set(plugin.uid, plugin)
  }

  return {
    get(uid) {
      return byUid.get(uid)
    },

    getForRequest(request) {
      const datasource = byUid.get(request.uid)
      if (!datasource) throw new DatasourceNotFoundError(request.uid)
      if (datasource.type !== request.type) {
        throw new DatasourceTypeMismatchError(request.uid, request.type, datasource.type)
      }
      return datasource
    },

    list() {
      return [...byUid.values()]
    },

    has(uid) {
      return byUid.has(uid)
    },

    toRecord() {
      return Object.fromEntries(byUid)
    },
  }
}
