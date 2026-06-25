# GitDesk WebUI

![Demo](docs/webui-demo.png)

<div align="center">

[中文 README](README.md)

</div>

GitDesk WebUI is a web-based Git repository management dashboard refactored from the open-source [GitHub Desktop](https://github.com/desktop/desktop) codebase. It retains the core features, interface layout, and interaction logic of GitHub Desktop while decoupling the original Electron-based local application architecture into a browser-based frontend and a Node.js backend. This design facilitates portable deployment across environments such as Windows, Linux, and Android (via shell), enabling remote management of Git repositories using desktop browsers or mobile devices.

The WebUI has largely completed the migration of features from the original Desktop application. It also includes enhancements for the web runtime, remote access, and multi-platform deployment, while addressing specific edge cases in Git workflows that surfaced during the porting process.

This project is not an official GitHub Desktop released by GitHub. It leverages GitHub Desktop's open-source code, MIT license, and upstream architectural design, while providing independent logic for building and deploying the WebUI.

## Key Features

- **Web-based GitHub Desktop Experience**: Retains the full logic of the original application, including repository lists, Changes, History, branching, committing, amending, stashing, discarding, fetching, pulling, pushing, publishing, force pushing, tagging, Pull Requests, and status checks.
- **Dedicated WebUI Runtime**: Features a Web shim refactored from Electron APIs, browser menu shims, remote dispatcher/store architecture, and WebUI-specific account/token isolation.
- **Multi-commit Operations**: Supports history organization workflows such as cherry-picking, squashing, and reordering/rebasing; includes progress tracking, conflict resolution, success notifications, and safeguards like Undo and Abort.
- **Remote and Mobile Management**: The backend handles Git operations, the file system, GitHub API interactions, the Copilot runtime, and configuration persistence, while the browser communicates via RPC and SSE for status updates—making it suitable for deployment on remote hosts, LAN devices, or mobile terminals.
- **Cross-platform Deployment**: A single set of build artifacts can be deployed to Windows, Linux, and POSIX-like environments based on configuration, with startup scripts provided (`run-webui.ps1` / `run-webui.sh`).
- **Copilot**: Supports Copilot for generating commit messages and resolving merge conflicts.

## Future Update Roadmap

The WebUI has currently completed the initial porting of features from the original desktop application; however, due to significant differences in operational logic between the WebUI and the local program, some workflows cannot be directly replicated. Future versions of GitDesk WebUI plan to introduce:

- [ ] Multi-language support;
- [ ] Web-based code editor;
- [ ] VS Code Server workspace (Web IDE environment);
- [ ] Web-based repository file management (file management logic similar to local file managers);
- [ ] Git Shell (a secure Web shell emulator for executing complex Git commands);
- [ ] Repository commit tree visualization;
- [ ] Action management panel (one-stop CI/CD management);
- [ ] ...

## Build and Deploy

See
[docs/technical/webui-build-and-deploy.md](docs/technical/webui-build-and-deploy.md)
for the full guide.

Windows build:

```powershell
powershell -ExecutionPolicy Bypass -File .\script\deploy-webui.ps1
powershell -ExecutionPolicy Bypass -File .\script\deploy-webui.ps1 -Production
```

Linux build:

```bash
bash script/deploy-webui.sh
bash script/deploy-webui.sh --production
```

The startup configuration is located at `out/server.conf`. The build script does not automatically start the WebUI; for deployment, copy the entire `out` directory and then launch the application according to the target platform:

```powershell
cd out
powershell -ExecutionPolicy Bypass -File .\run-webui.ps1
```

```bash
cd out
chmod +x ./run-webui.sh
./run-webui.sh
```

## Development Entry Points

Common WebUI commands:

```bash
yarn compile:webui
yarn compile:webui:prod
yarn start:webui
```

The main WebUI frontend, remote runtime, and backend entry points are:

- `app/src/ui/web-index.tsx`
- `app/src/ui/runtime`
- `app/src/ui/platform/*web-shim*`
- `app/src/web-server`
- `script/compile-webui.js`
- `script/deploy-webui.ps1`
- `script/deploy-webui.sh`

## License and Trademarks

- This project inherits the [MIT](LICENSE) license from the GitHub Desktop open-source code. The MIT license does not apply to GitHub's trademarks, including its logo designs; GitHub retains full trademark and copyright ownership of all its trademarks.

- GitHub®, its stylized versions, and the Invertocat logo are trademarks or registered trademarks of GitHub. Please ensure compliance with the GitHub logo usage guidelines when using the GitHub logo.

<!-- This is a visitor counter used to track how many people have visited my project homepage. -->
<div align="center">
  <img width="0" height="0" src="https://count.getloli.com/get/@:cctv18" />
</div>
<div align="center">
  <img width="0" height="0" src="https://count.getloli.com/get/@:desktop-webui" />
</div>
