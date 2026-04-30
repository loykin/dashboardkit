export class DatasourceNotFoundError extends Error {
  constructor(uid: string) {
    super(`datasource "${uid}" not registered in engine`)
    this.name = 'DatasourceNotFoundError'
  }
}

export class DatasourceTypeMismatchError extends Error {
  constructor(uid: string, expected: string, actual: string) {
    super(`datasource "${uid}" type mismatch: expected "${expected}", got "${actual}"`)
    this.name = 'DatasourceTypeMismatchError'
  }
}
