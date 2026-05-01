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
  required?: boolean

  // for type='select' | 'multiselect'
  choices?: Array<{ label: string; value: unknown }>

  // for type='number'
  min?: number
  max?: number
  step?: number
  integer?: boolean

  // for type='string' | type='color'
  minLength?: number
  maxLength?: number
  pattern?: RegExp

  // for type='array'
  items?: OptionSchema
  minItems?: number
  maxItems?: number

  // dynamic visibility condition based on other option values
  showIf?: (options: Record<string, unknown>) => boolean

  validate?: (
    value: unknown,
    options: Record<string, unknown>,
  ) => string | string[] | ValidationError[] | null | undefined
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

export interface ValidateOptionSchemaOptions {
  allowUnknown?: boolean
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
  validationOptions: ValidateOptionSchemaOptions = {},
): ValidationResult {
  const errors: ValidationError[] = []
  const { allowUnknown = true } = validationOptions

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {
      valid: false,
      errors: [{ path: basePath, message: 'options must be an object' }],
    }
  }

  const values = options as Record<string, unknown>

  if (!allowUnknown) {
    for (const key of Object.keys(values)) {
      if (!schema[key]) errors.push({ path: [...basePath, key], message: 'unknown option' })
    }
  }

  for (const [key, field] of Object.entries(schema)) {
    const value = values[key]
    if (value === undefined) {
      if (field.required && field.default === undefined) {
        errors.push({ path: [...basePath, key], message: 'required option is missing' })
      }
      continue
    }

    if (!optionTypeMatches(field, value)) {
      errors.push({ path: [...basePath, key], message: `expected ${field.type}` })
      continue
    }

    if ((field.type === 'string' || field.type === 'color') && typeof value === 'string') {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push({ path: [...basePath, key], message: `length must be >= ${field.minLength}` })
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push({ path: [...basePath, key], message: `length must be <= ${field.maxLength}` })
      }
      if (field.pattern && !field.pattern.test(value)) {
        errors.push({ path: [...basePath, key], message: 'does not match required pattern' })
      }
    }

    if (field.type === 'number' && typeof value === 'number') {
      if (field.integer && !Number.isInteger(value)) {
        errors.push({ path: [...basePath, key], message: 'must be an integer' })
      }
      if (field.min !== undefined && value < field.min) {
        errors.push({ path: [...basePath, key], message: `must be >= ${field.min}` })
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({ path: [...basePath, key], message: `must be <= ${field.max}` })
      }
    }

    if (field.type === 'array' && Array.isArray(value)) {
      if (field.minItems !== undefined && value.length < field.minItems) {
        errors.push({ path: [...basePath, key], message: `must contain at least ${field.minItems} items` })
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        errors.push({ path: [...basePath, key], message: `must contain at most ${field.maxItems} items` })
      }
      if (field.items) {
        value.forEach((item, index) => {
          const nested = validateOptionSchema(field.items!, item, [...basePath, key, String(index)], validationOptions)
          errors.push(...nested.errors)
        })
      }
    }

    const custom = field.validate?.(value, values)
    if (typeof custom === 'string') {
      errors.push({ path: [...basePath, key], message: custom })
    } else if (Array.isArray(custom)) {
      for (const item of custom) {
        if (typeof item === 'string') {
          errors.push({ path: [...basePath, key], message: item })
        } else {
          errors.push({ path: [...basePath, key, ...item.path], message: item.message })
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
