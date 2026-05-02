import type { DataRequestConfig } from '../schema'
import type { DatasourcePluginDef } from '../schema'
import type {
  DatasourceConnectorSupport,
  DatasourceEditorSupport,
  DatasourceSchemaSupport,
  DatasourceVariableSupport,
} from '../plugins'
import { DatasourceNotFoundError, DatasourceTypeMismatchError } from './errors'

export interface DatasourceRegistry {
  get(uid: string): DatasourcePluginDef | undefined
  getForRequest(request: DataRequestConfig): DatasourcePluginDef
  tryGetForRequest(request: DataRequestConfig): DatasourcePluginDef | undefined
  getVariableSupport(uid: string): DatasourceVariableSupport<unknown> | undefined
  getEditorSupport(uid: string): DatasourceEditorSupport<unknown, unknown> | undefined
  getConnectorSupport(uid: string): DatasourceConnectorSupport<unknown> | undefined
  getConnectorByType(type: string): DatasourceConnectorSupport<unknown> | undefined
  getSchemaSupport(uid: string): DatasourceSchemaSupport<unknown> | undefined
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

    tryGetForRequest(request) {
      return byUid.get(request.uid)
    },

    getVariableSupport(uid) {
      return byUid.get(uid)?.variable as DatasourceVariableSupport<unknown> | undefined
    },

    getEditorSupport(uid) {
      return byUid.get(uid)?.editor as DatasourceEditorSupport<unknown, unknown> | undefined
    },

    getConnectorSupport(uid) {
      return byUid.get(uid)?.connector as DatasourceConnectorSupport<unknown> | undefined
    },

    getConnectorByType(type) {
      return [...byUid.values()].find((plugin) => plugin.type === type && plugin.connector)
        ?.connector as DatasourceConnectorSupport<unknown> | undefined
    },

    getSchemaSupport(uid) {
      return byUid.get(uid)?.schema as DatasourceSchemaSupport<unknown> | undefined
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
