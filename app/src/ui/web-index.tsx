import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { App } from './app'
import { createRemoteRuntime } from './runtime/remote-runtime'

require('../../styles/desktop.scss')

;(globalThis as any).log = (globalThis as any).log ?? {
  error: (message: string, error?: Error) => console.error(message, error),
  warn: (message: string, error?: Error) => console.warn(message, error),
  info: (message: string, error?: Error) => console.info(message, error),
  debug: (message: string, error?: Error) => console.debug(message, error),
}

const startTime = performance.now()

async function render() {
  const runtime = await createRemoteRuntime()

  document.body.classList.add(`platform-${process.platform}`)

  ReactDOM.render(
    <App
      dispatcher={runtime.dispatcher as any}
      appStore={runtime.appStore as any}
      repositoryStateManager={runtime.repositoryStateManager as any}
      issuesStore={runtime.issuesStore as any}
      gitHubUserStore={runtime.gitHubUserStore as any}
      aheadBehindStore={runtime.aheadBehindStore as any}
      notificationsDebugStore={runtime.notificationsDebugStore as any}
      startTime={startTime}
    />,
    document.getElementById('desktop-app-container')!
  )
}

render().catch(error => {
  document.body.innerText = `Unable to start GitDesk WebUI: ${error.message}`
})
