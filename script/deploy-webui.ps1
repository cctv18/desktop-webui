param(
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 8080,
  [string]$AllowedRoot = "",
  [switch]$Production,
  [switch]$NoStart,
  [switch]$SkipInstall,
  [switch]$FullNativeInstall
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $ProjectRoot

if ([string]::IsNullOrWhiteSpace($AllowedRoot)) {
  $AllowedRoot = $ProjectRoot.Path
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
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

function Ensure-Node {
  if (-not (Test-Command "node")) {
    Write-Step "Node.js was not found. Trying to install Node.js LTS with winget."

    if (-not (Test-Command "winget")) {
      throw "Node.js is required, and winget was not found. Install Node.js 22 LTS, then rerun this script."
    }

    Invoke-Step "winget" @(
      "install",
      "-e",
      "--id",
      "OpenJS.NodeJS.LTS",
      "--accept-package-agreements",
      "--accept-source-agreements"
    )
    Refresh-Path
  }

  if (-not (Test-Command "node")) {
    throw "Node.js is still not available. Open a new PowerShell window and rerun this script."
  }

  $nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
  Write-Step "Node.js version: $(& node -v)"

  if ($nodeMajor -lt 18) {
    throw "Node.js 18 or newer is required. Node.js 22 LTS is recommended for WebUI testing."
  }

  if ($nodeMajor -gt 22) {
    Write-Warning "Node.js 22 LTS is recommended. Newer versions such as Node.js $nodeMajor may expose dependency compatibility issues."
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
    (Test-Path (Join-Path $ProjectRoot "app\node_modules\dugite"))
  )
}

function Invoke-YarnInstall {
  param(
    [string]$Directory,
    [bool]$IgnoreScripts
  )

  Push-Location $Directory
  try {
    $arguments = @("install", "--network-timeout", "600000")
    if ($IgnoreScripts) {
      $arguments += "--ignore-scripts"
    }
    Invoke-Step "yarn" $arguments
  } finally {
    Pop-Location
  }
}

Write-Step "Project root: $($ProjectRoot.Path)"
Write-Step "Allowed root: $AllowedRoot"

Ensure-Node
Ensure-Yarn

if (-not $SkipInstall) {
  if ($FullNativeInstall) {
    Write-Step "Installing full Desktop dependencies with native install scripts."
    Write-Warning "Full native install requires Visual Studio Build Tools with the Desktop development with C++ workload on Windows."
    Invoke-YarnInstall $ProjectRoot.Path $false
  } else {
    Write-Step "Installing root dependencies for WebUI with native scripts disabled."
    Invoke-YarnInstall $ProjectRoot.Path $true

    Write-Step "Installing app dependencies for WebUI with native scripts disabled."
    Invoke-YarnInstall (Join-Path $ProjectRoot "app") $true
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
  exit 0
}

Write-Step "Starting GitDesk WebUI on http://$HostAddress`:$Port"
Invoke-Step "node" @(
  "out\web-server.js",
  "--host",
  $HostAddress,
  "--port",
  "$Port",
  "--allowedRoot",
  $AllowedRoot
)
