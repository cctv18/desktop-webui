# GitDesk WebUI Build and Deploy

This document describes the separated WebUI build and runtime flow for Windows
and Linux.

## Build Outputs

WebUI builds write deployable files to `out`:

- `out/web-server.js`: bundled WebUI backend.
- `out/web`: browser assets served by the backend.
- `out/server.conf`: runtime configuration read by the launchers.
- `out/run-webui.ps1`: Windows runtime launcher.
- `out/run-webui.sh`: Linux/Android/POSIX runtime launcher.

Build scripts do not start the WebUI server. Edit `out/server.conf` and run the
matching `out/run-webui.*` launcher after the build is complete.

## Windows Build

From the `desktop-webui` directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\deploy-webui.ps1
```

For a production bundle:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\deploy-webui.ps1 -Production
```

To remove generated source maps after a successful build:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\deploy-webui.ps1 -Production -DeleteSourceMaps
```

The helper installs root and `app` dependencies when needed, then runs the WebUI
compile script. It no longer accepts runtime parameters such as host, port,
allowed roots, Git paths, static root, Copilot path, OAuth callback URL, platform,
or no-start.

Manual Windows build:

```powershell
yarn install --network-timeout 600000 --ignore-scripts --ignore-platform
Push-Location app
yarn install --network-timeout 600000 --ignore-scripts --ignore-platform
Pop-Location
yarn run compile:webui:prod
```

## Linux Build

From the `desktop-webui` directory:

```bash
bash script/deploy-webui.sh
```

For a production bundle:

```bash
bash script/deploy-webui.sh --production
```

To remove generated source maps after a successful build:

```bash
bash script/deploy-webui.sh --production --delete-source-maps
```

Manual Linux build:

```bash
yarn install --network-timeout 600000 --ignore-scripts --ignore-platform
(cd app && yarn install --network-timeout 600000 --ignore-scripts --ignore-platform)
yarn run compile:webui:prod
```

## Deploy and Run

Copy the complete `out` directory to the target machine or directory. The runtime
configuration lives in `server.conf`, next to `web-server.js`.

Common `server.conf` values:

```ini
host=127.0.0.1
port=8080
public-url=http://127.0.0.1:8080
allowedRoot=.
data-dir=.gitdesk-webui
static-root=web
log-file=webui.log
skip-system-proxy=false
```

Windows runtime:

```powershell
cd out
powershell -ExecutionPolicy Bypass -File .\run-webui.ps1
```

Linux runtime:

```bash
cd out
chmod +x ./run-webui.sh
./run-webui.sh
```

The launchers still accept runtime command line overrides, but `server.conf` is
the preferred portable configuration surface.

## Diagnostics

The compile script writes build diagnostics to `out/webui-build.log`,
`out/webui-diagnostics.log`, and `out/webui-diagnostics.json` unless overridden by
environment variables.

The build helper scripts write their log to `out/webui-deploy.log` by default and
map compile diagnostics to:

- `out/webui-deploy.diagnostics.log`
- `out/webui-deploy.diagnostics.json`

`webui-deploy.diagnostics.json` is deleted automatically after a successful WebUI
build. It is kept when the build fails so the full webpack diagnostic payload is
available for debugging.

## Resource Pruning

The WebUI build omits Desktop-only or unused static assets from `out/web/static`:

- `github.bat`
- `github.sh`
- `cherry-pick-intro.png`
- `explore.svg`
- `organized-by-project-status.svg`

Release note header SVGs, welcome illustrations, empty-state SVGs, license data,
and gitignore templates are still copied because current WebUI code references
them at runtime.

The WebUI build does not copy the `web/emoji` image bundle. It writes an empty
`web/emoji.json` placeholder so the existing startup path can load emoji data
without a missing-file warning, but no `gemoji` metadata or image assets are
included in the deployable WebUI output.

The WebUI build no longer reads from the `gemoji` submodule. If the repository no
longer needs the original Electron Desktop packaging path that still copies
`gemoji` in `script/build.ts`, the submodule can be removed manually:

```bash
git submodule deinit -f gemoji
git rm -f gemoji
rm -rf .git/modules/gemoji
git add .gitmodules
```

Only run those commands after confirming non-WebUI packaging tasks no longer need
`gemoji/db/emoji.json` or `gemoji/images/emoji`.
