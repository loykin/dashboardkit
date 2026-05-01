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

export interface ValidationError {
  path: string[]
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

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

function optionTypeMatches(field: OptionField, value: unknown): boolean {
  switch (field.type) {
    case 'string':
    case 'color':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'select':
      return field.choices ? field.choices.some((choice) => choice.value === value) : true
    case 'multiselect':
      return Array.isArray(value) && (
        !field.choices ||
        value.every((item) => field.choices?.some((choice) => choice.value === item))
      )
    case 'array':
      return Array.isArray(value)
    case 'json':
      return true
    default:
      return false
  }
}

export function validateOptionSchema(
  schema: OptionSchema,
  options: unknown,
  basePath: string[] = [],
): ValidationResult {
  const errors: ValidationError[] = []

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {
      valid: false,
      errors: [{ path: basePath, message: 'options must be an object' }],
    }
  }

  const values = options as Record<string, unknown>
  for (const [key, field] of Object.entries(schema)) {
    const value = values[key]
    if (value === undefined) continue

    if (!optionTypeMatches(field, value)) {
      errors.push({ path: [...basePath, key], message: `expected ${field.type}` })
      continue
    }

    if (field.type === 'number' && typeof value === 'number') {
      if (field.min !== undefined && value < field.min) {
        errors.push({ path: [...basePath, key], message: `must be >= ${field.min}` })
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({ path: [...basePath, key], message: `must be <= ${field.max}` })
      }
    }

    if (field.type === 'array' && field.items && Array.isArray(value)) {
      value.forEach((item, index) => {
        const nested = validateOptionSchema(field.items!, item, [...basePath, key, String(index)])
        errors.push(...nested.errors)
      })
    }
  }

  return { valid: errors.length === 0, errors }
}
