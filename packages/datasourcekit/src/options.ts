export type OptionFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'color'
  | 'json'
  | 'array'

export interface ValidationError {
  path: string[]
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export interface OptionField {
  type: OptionFieldType
  label: string
  description?: string
  default?: unknown
  required?: boolean
  choices?: Array<{ label: string; value: unknown }>
  min?: number
  max?: number
  step?: number
  integer?: boolean
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  items?: OptionSchema
  minItems?: number
  maxItems?: number
  showIf?: (options: Record<string, unknown>) => boolean
  validate?: (
    value: unknown,
    options: Record<string, unknown>,
  ) => string | string[] | ValidationError[] | null | undefined
}

export type OptionSchema = Record<string, OptionField>
