export enum HKEY {
  HKEY_CLASSES_ROOT = 'HKEY_CLASSES_ROOT',
  HKEY_CURRENT_USER = 'HKEY_CURRENT_USER',
  HKEY_LOCAL_MACHINE = 'HKEY_LOCAL_MACHINE',
}

export enum RegistryValueType {
  REG_SZ = 'REG_SZ',
  REG_EXPAND_SZ = 'REG_EXPAND_SZ',
}

export type RegistryValue = {
  readonly name: string
  readonly type: RegistryValueType
  readonly data: string
}

export function enumerateValues(
  _hkey: HKEY,
  _subKey: string
): ReadonlyArray<RegistryValue> {
  return []
}

export function enumerateKeys(_hkey: HKEY, _subKey: string) {
  return new Array<string>()
}
