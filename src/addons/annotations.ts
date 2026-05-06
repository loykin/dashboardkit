import type { Annotation, CoreEngineAPI } from '../schema'

export interface AnnotationAddon {
  getAnnotations(timeRange?: { from: string; to: string }): Promise<Annotation[]>
}

export function createAnnotationAddon(engine: CoreEngineAPI): AnnotationAddon {
  return {
    getAnnotations(timeRange) {
      return engine.queryAnnotations(timeRange)
    },
  }
}
