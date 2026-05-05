import type {
  DatasourceConnectorSupport,
  DatasourceEditorSupport,
  DatasourcePluginDef,
  DatasourceSchemaSupport,
  DatasourceVariableSupport,
} from './types'
import { DatasourceNotFoundError, DatasourceTypeMismatchError } from './errors'

export interface DatasourceRequestLike {
  uid?: string
  type?: string
  datasourceUid?: string
  datasourceType?: string
}

function requestUid(request: DatasourceRequestLike): string {
  return request.datasourceUid ?? request.uid ?? ''
}

function requestType(request: DatasourceRequestLike): string | undefined {
  return request.datasourceType ?? request.type
}

export interface DatasourceRegistry {
  register(def: DatasourcePluginDef): void
  get(uid: string): DatasourcePluginDef | undefined
  getForRequest(request: DatasourceRequestLike): DatasourcePluginDef
  tryGetForRequest(request: DatasourceRequestLike): DatasourcePluginDef | undefined
  getVariableSupport(uid: string): DatasourceVariableSupport<Record<string, unknown>> | undefined
  getEditorSupport(uid: string): DatasourceEditorSupport<Record<string, unknown>, unknown> | undefined
  getConnectorSupport(uid: string): DatasourceConnectorSupport<Record<string, unknown>> | undefined
  getConnectorByType(type: string): DatasourceConnectorSupport<Record<string, unknown>> | undefined
  getSchemaSupport(uid: string): DatasourceSchemaSupport<Record<string, unknown>> | undefined
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
    register(def) {
      byUid.set(def.uid, def)
    },

    get(uid) {
      return byUid.get(uid)
    },

    getForRequest(request) {
      const uid = requestUid(request)
      const datasource = byUid.get(uid)
      if (!datasource) throw new DatasourceNotFoundError(uid)
      const type = requestType(request)
      if (type && datasource.type !== type) {
        throw new DatasourceTypeMismatchError(uid, type, datasource.type)
      }
      return datasource
    },

    tryGetForRequest(request) {
      return byUid.get(requestUid(request))
    },

    getVariableSupport(uid) {
      return byUid.get(uid)?.variable
    },

    getEditorSupport(uid) {
      return byUid.get(uid)?.editor
    },

    getConnectorSupport(uid) {
      return byUid.get(uid)?.connector
    },

    getConnectorByType(type) {
      return [...byUid.values()].find((plugin) => plugin.type === type && plugin.connector)
        ?.connector
    },

    getSchemaSupport(uid) {
      return byUid.get(uid)?.schema
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
