param(
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 8080,
  [string]$PublicUrl = "",
  [string]$AllowedRoot = "",
  [string]$Platform = "all",
  [switch]$DebugBuild,
  [switch]$DeleteSourceMaps,
  [switch]$Production,
  [switch]$NoStart,
  [switch]$SkipInstall,
  [switch]$FullNativeInstall,
  [string]$GitPath = "",
  [string]$GitDirectory = "",
  [string]$GitExecPath = "",
  [string]$GitConfigGlobal = "",
  [string]$DataDir = "",
  [string]$StaticRoot = "",
  [string]$CopilotCliPath = "",
  [string]$OAuthClientId = "",
  [string]$OAuthClientSecret = "",
  [string]$OAuthCallbackUrl = "",
  [string]$LogFile = "out\webui-deploy.log"
)

$ErrorActionPreference = "Stop"
$RequiredNodeMajor = 20
$PreferredNodeMajor = 22

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $ProjectRoot

if ([string]::IsNullOrWhiteSpace($AllowedRoot)) {
  $AllowedRoot = $ProjectRoot.Path
}

$script:ResolvedLogFile = $null

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Start-DeployLog {
  if ([string]::IsNullOrWhiteSpace($LogFile)) {
    return
  }

  $resolved = $LogFile
  if (-not [System.IO.Path]::IsPathRooted($resolved)) {
    $resolved = Join-Path $ProjectRoot $resolved
  }

  $resolved = [System.IO.Path]::GetFullPath($resolved)
  $directory = Split-Path -Parent $resolved
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  if ([string]::IsNullOrWhiteSpace($env:NO_COLOR)) {
    $env:NO_COLOR = "1"
  }

  if ([string]::IsNullOrWhiteSpace($env:FORCE_COLOR)) {
    $env:FORCE_COLOR = "0"
  }

  if ([string]::IsNullOrWhiteSpace($env:WEBUI_BUILD_LOG)) {
    $env:WEBUI_BUILD_LOG = $resolved
  }

  if ([string]::IsNullOrWhiteSpace($env:WEBUI_DIAGNOSTICS_LOG)) {
    $env:WEBUI_DIAGNOSTICS_LOG = [System.IO.Path]::ChangeExtension($resolved, ".diagnostics.log")
  }

  if ([string]::IsNullOrWhiteSpace($env:WEBUI_DIAGNOSTICS_JSON)) {
    $env:WEBUI_DIAGNOSTICS_JSON = [System.IO.Path]::ChangeExtension($resolved, ".diagnostics.json")
  }

  if ([string]::IsNullOrWhiteSpace($env:WEBUI_CONSOLE_DIAGNOSTICS)) {
    $env:WEBUI_CONSOLE_DIAGNOSTICS = "0"
  }

  $script:ResolvedLogFile = $resolved
}

function Stop-DeployLog {
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Test-Command {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NormalizedPlatform {
  param([string]$Value)

  switch ($Value.ToLowerInvariant()) {
    "" { return "all" }
    "all" { return "all" }
    "current" { return (& node -p "process.platform").Trim() }
    "host" { return (& node -p "process.platform").Trim() }
    "windows" { return "win32" }
    "win" { return "win32" }
    "win32" { return "win32" }
    "mac" { return "darwin" }
    "macos" { return "darwin" }
    "darwin" { return "darwin" }
    "linux" { return "linux" }
    "android" { return "android" }
    default {
      throw "Unsupported platform: $Value. Use all, current, win32/windows, linux, darwin/macos, or android."
    }
  }
}

function Test-ShouldIgnoreYarnPlatform {
  param([string]$NormalizedPlatform)

  $hostPlatform = (& node -p "process.platform").Trim()
  return $NormalizedPlatform -eq "all" -or $NormalizedPlatform -ne $hostPlatform
}

function Get-DefaultPublicUrl {
  $urlHost = $HostAddress

  if ($urlHost -eq "0.0.0.0" -or $urlHost -eq "::" -or $urlHost -eq "[::]") {
    $urlHost = "127.0.0.1"
  } elseif ($urlHost.Contains(":") -and -not $urlHost.StartsWith("[")) {
    $urlHost = "[$urlHost]"
  }

  return "http://$urlHost`:$Port"
}

function Invoke-Step {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Install-NodeLTS {
  Write-Step "Installing Node.js $PreferredNodeMajor LTS with winget."

  if (-not (Test-Command "winget")) {
    throw "Node.js $RequiredNodeMajor or newer is required, and winget was not found. Install Node.js $PreferredNodeMajor LTS, then rerun this script."
  }

  & winget upgrade -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    & winget install `
      -e `
      --id OpenJS.NodeJS.LTS `
      --accept-package-agreements `
      --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "winget could not install or upgrade Node.js LTS. The version check will continue and report a hard error if Node.js is still too old."
    }
  }

  Refresh-Path
}

function Ensure-Node {
  if (-not (Test-Command "node")) {
    Install-NodeLTS
  }

  if (-not (Test-Command "node")) {
    throw "Node.js is still not available. Open a new PowerShell window and rerun this script."
  }

  $nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
  if ($nodeMajor -lt $RequiredNodeMajor) {
    Install-NodeLTS
  }

  if (-not (Test-Command "node")) {
    throw "Node.js is still not available. Open a new PowerShell window and rerun this script."
  }

  $nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
  $nodePlatform = (& node -p 'process.platform').Trim()
  $nodeArch = (& node -p 'process.arch').Trim()
  Write-Step "Node.js version: $(& node -v)"
  Write-Step "Node.js platform/arch: $nodePlatform/$nodeArch"

  if ($nodeMajor -lt $RequiredNodeMajor) {
    throw "Node.js $RequiredNodeMajor or newer is required. Node.js $PreferredNodeMajor LTS is recommended for WebUI testing."
  }

  if ($nodeMajor -gt $PreferredNodeMajor) {
    Write-Warning "Node.js $PreferredNodeMajor LTS is recommended. Newer versions such as Node.js $nodeMajor may expose dependency compatibility issues."
  }

  switch ($nodeArch) {
    "x64" { break }
    "arm64" { break }
    "arm" {
      Write-Warning "ARMv7/armv7a WebUI deployment is experimental. Some upstream Desktop dependencies do not publish ARMv7 prebuilt packages; prefer x64 or arm64 when possible."
      break
    }
    default {
      Write-Warning "Architecture '$nodeArch' is not a primary WebUI target. x64 and arm64 are the expected deployment architectures."
      break
    }
  }
}

function Ensure-Yarn {
  if (Test-Command "yarn") {
    Write-Step "Yarn version: $(& yarn --version)"
    return
  }

  Write-Step "Yarn was not found. Trying Corepack first."

  if (Test-Command "corepack") {
    & corepack enable
    & corepack prepare yarn@1.22.22 --activate
    Refresh-Path
  }

  if (-not (Test-Command "yarn")) {
    Write-Step "Installing Yarn 1.x with npm."
    Invoke-Step "npm" @("install", "--global", "yarn@1.22.22")
    Refresh-Path
  }

  if (-not (Test-Command "yarn")) {
    throw "Yarn is still not available. Install Yarn 1.x, then rerun this script."
  }

  Write-Step "Yarn version: $(& yarn --version)"
}

function Test-ProjectDependencies {
  return (
    (Test-Path (Join-Path $ProjectRoot "node_modules\ts-node")) -and
    (Test-Path (Join-Path $ProjectRoot "node_modules\webpack")) -and
    (Test-Path (Join-Path $ProjectRoot "app\node_modules\react")) -and
    (Test-Path (Join-Path $ProjectRoot "app\node_modules\dugite")) -and
    (Test-Path (Join-Path $ProjectRoot "app\node_modules\@github\copilot"))
  )
}

function Invoke-YarnInstall {
  param(
    [string]$Directory,
    [bool]$IgnoreScripts,
    [bool]$IgnorePlatform
  )

  Push-Location $Directory
  try {
    $arguments = @("install", "--network-timeout", "600000")
    if ($IgnoreScripts) {
      $arguments += "--ignore-scripts"
    }
    if ($IgnorePlatform) {
      $arguments += "--ignore-platform"
    }
    Invoke-Step "yarn" $arguments
  } finally {
    Pop-Location
  }
}

trap {
  Stop-DeployLog
  break
}

Start-DeployLog

Write-Step "Project root: $($ProjectRoot.Path)"
Write-Step "Allowed root: $AllowedRoot"
if (-not [string]::IsNullOrWhiteSpace($script:ResolvedLogFile)) {
  Write-Step "Detailed WebUI build log: $script:ResolvedLogFile"
  Write-Step "Detailed WebUI diagnostics log: $env:WEBUI_DIAGNOSTICS_LOG"
  Write-Step "Detailed WebUI diagnostics JSON: $env:WEBUI_DIAGNOSTICS_JSON"
}

Ensure-Node
$Platform = Get-NormalizedPlatform $Platform
$ignoreYarnPlatform = Test-ShouldIgnoreYarnPlatform $Platform
$env:WEBUI_TARGET_PLATFORM = $Platform
$env:WEBUI_DEBUG_BUILD = if ($DebugBuild) { "1" } else { "0" }
$env:WEBUI_DELETE_SOURCE_MAPS = if ($DeleteSourceMaps) { "1" } else { "0" }
$debugBuildText = if ($DebugBuild) { "yes" } else { "no" }
$deleteSourceMapsText = if ($DeleteSourceMaps) { "yes" } else { "no" }
Write-Step "Target platform: $Platform"
Write-Step "Debug build: $debugBuildText"
Write-Step "Delete source maps: $deleteSourceMapsText"
Ensure-Yarn

if (-not $SkipInstall) {
  Write-Step "Yarn optional dependency platform/CPU exclusion messages are expected; Yarn is selecting packages for the current architecture."

  if ($FullNativeInstall) {
    Write-Step "Installing full Desktop dependencies with native install scripts."
    Write-Warning "Full native install requires Visual Studio Build Tools with the Desktop development with C++ workload on Windows."
    Invoke-YarnInstall $ProjectRoot.Path $false $ignoreYarnPlatform
  } else {
    Write-Step "Installing root dependencies for WebUI with native scripts disabled."
    Invoke-YarnInstall $ProjectRoot.Path $true $ignoreYarnPlatform

    Write-Step "Installing app dependencies for WebUI with native scripts disabled."
    Invoke-YarnInstall (Join-Path $ProjectRoot "app") $true $ignoreYarnPlatform
  }
} elseif (-not (Test-ProjectDependencies)) {
  throw "Project dependencies are missing. Rerun without -SkipInstall."
}

if (-not (Test-ProjectDependencies)) {
  throw "Project dependencies are still incomplete after install. Check Yarn output for failed network steps, or rerun without -SkipInstall."
}

if ($Production) {
  Write-Step "Compiling WebUI production bundle."
  Invoke-Step "yarn" @("run", "compile:webui:prod")
} else {
  Write-Step "Compiling WebUI development bundle."
  Invoke-Step "yarn" @("run", "compile:webui")
}

$serverBundle = Join-Path $ProjectRoot "out\web-server.js"
if (-not (Test-Path $serverBundle)) {
  throw "WebUI server bundle was not produced: $serverBundle"
}

if ($NoStart) {
  Write-Step "Build completed. Skipping server start because -NoStart was set."
  Stop-DeployLog
  exit 0
}

$runScript = Join-Path $ProjectRoot "out\run-webui.ps1"
if (-not (Test-Path $runScript)) {
  throw "WebUI runtime launcher was not produced: $runScript"
}

if ([string]::IsNullOrWhiteSpace($PublicUrl)) {
  $PublicUrl = Get-DefaultPublicUrl
}

Write-Step "Starting GitDesk WebUI via out\run-webui.ps1 on $PublicUrl"
$runArguments = @(
  "-HostAddress",
  $HostAddress,
  "-Port",
  "$Port",
  "-PublicUrl",
  $PublicUrl,
  "-AllowedRoot",
  $AllowedRoot
)

if (-not [string]::IsNullOrWhiteSpace($GitPath)) {
  $runArguments += @("-GitPath", $GitPath)
}

if (-not [string]::IsNullOrWhiteSpace($GitDirectory)) {
  $runArguments += @("-GitDirectory", $GitDirectory)
}

if (-not [string]::IsNullOrWhiteSpace($GitExecPath)) {
  $runArguments += @("-GitExecPath", $GitExecPath)
}

if (-not [string]::IsNullOrWhiteSpace($GitConfigGlobal)) {
  $runArguments += @("-GitConfigGlobal", $GitConfigGlobal)
}

if (-not [string]::IsNullOrWhiteSpace($DataDir)) {
  $runArguments += @("-DataDir", $DataDir)
}

if (-not [string]::IsNullOrWhiteSpace($StaticRoot)) {
  $runArguments += @("-StaticRoot", $StaticRoot)
}

if (-not [string]::IsNullOrWhiteSpace($CopilotCliPath)) {
  $runArguments += @("-CopilotCliPath", $CopilotCliPath)
}

if (-not [string]::IsNullOrWhiteSpace($OAuthClientId)) {
  $runArguments += @("-OAuthClientId", $OAuthClientId)
}

if (-not [string]::IsNullOrWhiteSpace($OAuthClientSecret)) {
  $runArguments += @("-OAuthClientSecret", $OAuthClientSecret)
}

if (-not [string]::IsNullOrWhiteSpace($OAuthCallbackUrl)) {
  $runArguments += @("-OAuthCallbackUrl", $OAuthCallbackUrl)
}

& $runScript @runArguments
if ($LASTEXITCODE -ne 0) {
  throw "Command failed with exit code ${LASTEXITCODE}: $runScript $($runArguments -join ' ')"
}

Stop-DeployLog
