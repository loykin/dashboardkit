// ─── OptionSchema Type ──────────────────────────────────────────────────────────
// The way plugins declare their options structure.
// Used for auto-generating editor UI, validation, and default value injection.

export type OptionFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select' // fixed choices
  | 'multiselect' // multi-select
  | 'color' // color picker
  | 'json' // free-form JSON input
  | 'array' // array (items schema applied recursively)

export interface OptionField {
  type: OptionFieldType
  label: string
  description?: string
  default?: unknown

  // for type='select' | 'multiselect'
  choices?: Array<{ label: string; value: unknown }>

  // for type='number'
  min?: number
  max?: number
  step?: number

  // for type='array'
  items?: OptionSchema

  // dynamic visibility condition based on other option values
  showIf?: (options: Record<string, unknown>) => boolean
}

export type OptionSchema = Record<string, OptionField>

/**
 * Fill in default values from OptionSchema into the options object.
 */
export function applyOptionDefaults(
  schema: OptionSchema,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...options }
  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined && field.default !== undefined) {
      result[key] = field.default
    }
  }
  return result
}
