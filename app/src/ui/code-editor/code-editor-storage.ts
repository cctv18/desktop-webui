import { invokeWebUIRPC } from '../../lib/webui-rpc'

export async function readCodeEditorStorageItem(key: string) {
  return invokeWebUIRPC<string | null>('codeEditor.readStorageItem', [key])
}

export async function writeCodeEditorStorageItem(key: string, value: string) {
  return invokeWebUIRPC<void>('codeEditor.writeStorageItem', [key, value])
}

export async function removeCodeEditorStorageItem(key: string) {
  return invokeWebUIRPC<void>('codeEditor.removeStorageItem', [key])
}
