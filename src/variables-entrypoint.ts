// Convenience re-exports for built-in variable type plugins.
// Short names (textboxVariable, etc.) are aliases for the -Type suffixed names.
export {
  constantVariableType,
  customVariableType,
  textboxVariableType,
  intervalVariableType,
  queryVariableType,
  builtinVariableTypes,
  constantVariableType as constantVariable,
  customVariableType as customVariable,
  textboxVariableType as textboxVariable,
  intervalVariableType as intervalVariable,
  queryVariableType as queryVariable,
} from './variables/variable-types'
export type { VariableTypePluginDef } from './schema/define'
