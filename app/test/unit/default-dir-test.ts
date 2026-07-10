import { strict as assert } from 'assert'
import { describe, it } from 'node:test'

import { getDefaultDirStorageTarget } from '../../src/ui/lib/default-dir-storage'

describe('Default clone directory persistence', () => {
  it('routes WebUI renderers and servers to backend persistence', () => {
    assert.equal(getDefaultDirStorageTarget('web'), 'backend-rpc')
    assert.equal(getDefaultDirStorageTarget('web-server'), 'backend-file')
  })

  it('keeps Electron renderer persistence local to the desktop app', () => {
    assert.equal(getDefaultDirStorageTarget('renderer'), 'local-storage')
    assert.equal(getDefaultDirStorageTarget('main'), 'local-storage')
  })
})
