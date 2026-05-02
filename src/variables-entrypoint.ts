// Convenience re-exports for built-in variable type plugins.
// Short names (textboxVariable, etc.) are aliases for the -Type suffixed names.
export {
  constantVariableType,
  customVariableType,
  textboxVariableType,
  intervalVariableType,
  queryVariableType,
  datetimeVariableType,
  refreshVariableType,
  builtinVariableTypes,
  constantVariableType as constantVariable,
  customVariableType as customVariable,
  textboxVariableType as textboxVariable,
  intervalVariableType as intervalVariable,
  queryVariableType as queryVariable,
  datetimeVariableType as datetimeVariable,
  refreshVariableType as refreshVariable,
} from './variables/variable-types'
export type { VariableTypePluginDef } from './schema/define'
