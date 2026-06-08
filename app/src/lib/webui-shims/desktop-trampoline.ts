export function getDesktopAskpassTrampolineFilename() {
  return process.platform === 'win32'
    ? 'desktop-trampoline.exe'
    : 'desktop-trampoline'
}
