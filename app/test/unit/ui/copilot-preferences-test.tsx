import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import * as React from 'react'
import { render, screen, fireEvent } from '../../helpers/ui/render'
import type { ModelInfo } from '@github/copilot-sdk'
import type { IBYOKProvider } from '../../../src/lib/copilot/byok'

const DefaultCopilotModel = 'gpt-5-mini'

type CopilotFeature = 'commit-message-generation' | 'conflict-resolution'

function encodeModelKey(
  key:
    | { readonly kind: 'copilot'; readonly modelId: string }
    | {
        readonly kind: 'byok'
        readonly providerId: string
        readonly modelId: string
      }
) {
  if (key.kind === 'byok') {
    return `byok:${key.providerId}:${key.modelId}`
  }

  return `copilot:${key.modelId}`
}

mock.module('../../../src/lib/app-shell', {
  namedExports: {
    shell: {
      beep: () => {},
      moveItemToTrash: async () => {},
      openExternal: async () => true,
      openPath: async () => '',
      showFolderContents: () => {},
      showItemInFolder: () => {},
    },
  },
})

mock.module('../../../src/ui/main-process-proxy', {
  namedExports: {
    checkForUpdates: async () => {},
    isRunningUnderARM64Translation: async () => false,
    moveItemToTrash: async () => {},
    onAutoUpdaterCheckingForUpdate: () => {},
    onAutoUpdaterError: () => {},
    onAutoUpdaterUpdateAvailable: () => {},
    onAutoUpdaterUpdateDownloaded: () => {},
    onAutoUpdaterUpdateNotAvailable: () => {},
    onNativeThemeUpdated: () => {},
    openExternal: async () => true,
    quitAndInstallUpdate: () => {},
    sendDialogDidOpen: () => {},
    sendWillQuitSync: () => {},
    setNativeThemeSource: () => {},
    showFolderContents: () => {},
    showItemInFolder: () => {},
    shouldUseDarkColors: async () => false,
  },
})

function makeModel(
  overrides: Partial<ModelInfo> & Pick<ModelInfo, 'id' | 'name'>
): ModelInfo {
  return {
    capabilities: {
      supports: { vision: false, reasoningEffort: false },
      limits: { max_context_window_tokens: 128000 },
    },
    ...overrides,
  }
}

const defaultModel = makeModel({
  id: DefaultCopilotModel,
  name: 'GPT-5 mini',
  billing: { multiplier: 1 },
})

const otherModel = makeModel({
  id: 'claude-sonnet',
  name: 'Claude Sonnet',
  billing: { multiplier: 2 },
})

const models: ReadonlyArray<ModelInfo> = [defaultModel, otherModel]

const ollamaProvider: IBYOKProvider = {
  id: 'ollama-id',
  name: 'Ollama',
  type: 'openai',
  baseUrl: 'http://localhost:11434/v1',
  authKind: 'none',
  models: [
    { id: 'llama3', name: 'Llama 3' },
    { id: 'phi-4', name: 'Phi 4' },
  ],
}

function defaults() {
  return {
    selectedCopilotModels: {},
    copilotModels: models,
    copilotAvailable: true,
    byokProviders: [],
    showBYOKSettings: false,
    onSelectedCopilotModelChanged: () => {},
    onAddBYOKProvider: () => {},
    onEditBYOKProvider: () => {},
    onDeleteBYOKProvider: () => {},
  }
}

type CopilotPreferencesComponent =
  typeof import('../../../src/ui/preferences/copilot').CopilotPreferences
type CopilotPreferencesProps = React.ComponentProps<CopilotPreferencesComponent>

let copilotPreferencesComponent: CopilotPreferencesComponent | null = null

async function getCopilotPreferences() {
  if (copilotPreferencesComponent === null) {
    copilotPreferencesComponent = (
      await import('../../../src/ui/preferences/copilot')
    ).CopilotPreferences
  }

  return copilotPreferencesComponent
}

async function renderCopilotPreferences(
  overrides: Partial<CopilotPreferencesProps> = {}
) {
  const CopilotPreferences = await getCopilotPreferences()
  const props = { ...defaults(), ...overrides } as CopilotPreferencesProps
  return render(<CopilotPreferences {...props} />)
}

describe('CopilotPreferences', () => {
  it('shows sign-in message when copilot is not available', async () => {
    await renderCopilotPreferences({
      copilotModels: null,
      copilotAvailable: false,
    })

    assert.ok(
      screen.getByText(
        'Sign in to a GitHub.com account in the Accounts tab to configure Copilot settings.'
      )
    )
    assert.strictEqual(screen.queryByRole('combobox'), null)
  })

  it('shows loading message when models not yet fetched', async () => {
    await renderCopilotPreferences({ copilotModels: null })
    assert.ok(screen.getByText('Loading available models…'))
  })

  it('shows Auto when fetch completed with empty result', async () => {
    const view = await renderCopilotPreferences({ copilotModels: [] })
    assert.ok(
      !screen.queryByText(
        'No models available. Check your Copilot subscription.'
      )
    )

    const select = view.container.querySelector('select') as HTMLSelectElement
    const options = Array.from(select.options).map(option => option.textContent)
    assert.deepStrictEqual(options, ['Auto', 'None (hide Copilot button)'])
    assert.strictEqual(select.value, select.options[0].value)
  })

  it('renders a Copilot optgroup with the available models', async () => {
    const view = await renderCopilotPreferences()

    const optgroups = view.container.querySelectorAll('optgroup')
    assert.strictEqual(optgroups.length, 1)
    assert.strictEqual(optgroups[0].label, 'GitHub Copilot')

    const options = view.container.querySelectorAll('option')
    assert.strictEqual(options[0].textContent, 'Auto')
    assert.strictEqual(options[1].textContent, 'None (hide Copilot button)')
    assert.strictEqual(options[2].textContent, 'GPT-5 mini (default)')
    assert.strictEqual(options[3].textContent, 'Claude Sonnet')
  })

  it('renders a BYOK optgroup per provider', async () => {
    const view = await renderCopilotPreferences({
      byokProviders: [ollamaProvider],
    })
    const labels = Array.from(view.container.querySelectorAll('optgroup')).map(
      g => g.label
    )
    assert.deepStrictEqual(labels, ['GitHub Copilot', 'Ollama'])
  })

  it('selects Auto when no model is selected', async () => {
    const view = await renderCopilotPreferences()
    const select = view.container.querySelector('select') as HTMLSelectElement
    const autoOption = Array.from(select.options).find(
      option => option.textContent === 'Auto'
    )
    assert.ok(autoOption)
    assert.strictEqual(select.value, autoOption.value)
  })

  it('treats legacy bare-string selections as Copilot models', async () => {
    const view = await renderCopilotPreferences({
      selectedCopilotModels: { 'commit-message-generation': 'claude-sonnet' },
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    assert.strictEqual(
      select.value,
      encodeModelKey({ kind: 'copilot', modelId: 'claude-sonnet' })
    )
  })

  it('selects the matching BYOK option when chosen', async () => {
    const view = await renderCopilotPreferences({
      byokProviders: [ollamaProvider],
      selectedCopilotModels: {
        'commit-message-generation': encodeModelKey({
          kind: 'byok',
          providerId: ollamaProvider.id,
          modelId: 'llama3',
        }),
      },
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    assert.strictEqual(
      select.value,
      encodeModelKey({
        kind: 'byok',
        providerId: ollamaProvider.id,
        modelId: 'llama3',
      })
    )
  })

  it('emits the encoded composite key on change', async () => {
    const changed: Array<{ feature: CopilotFeature; model: string | null }> = []
    const view = await renderCopilotPreferences({
      onSelectedCopilotModelChanged: (f, m) =>
        changed.push({ feature: f, model: m }),
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, {
      target: {
        value: encodeModelKey({ kind: 'copilot', modelId: 'claude-sonnet' }),
      },
    })
    assert.deepStrictEqual(changed, [
      {
        feature: 'commit-message-generation',
        model: encodeModelKey({ kind: 'copilot', modelId: 'claude-sonnet' }),
      },
    ])
  })

  it('emits the selected value directly on change', async () => {
    const changed: Array<{ feature: CopilotFeature; model: string | null }> = []
    const view = await renderCopilotPreferences({
      selectedCopilotModels: { 'commit-message-generation': 'claude-sonnet' },
      onSelectedCopilotModelChanged: (f, m) =>
        changed.push({ feature: f, model: m }),
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, {
      target: {
        value: encodeModelKey({
          kind: 'copilot',
          modelId: DefaultCopilotModel,
        }),
      },
    })
    assert.deepStrictEqual(changed, [
      {
        feature: 'commit-message-generation',
        model: encodeModelKey({
          kind: 'copilot',
          modelId: DefaultCopilotModel,
        }),
      },
    ])
  })

  it('emits null when Auto is selected', async () => {
    const changed: Array<{ feature: CopilotFeature; model: string | null }> = []
    const view = await renderCopilotPreferences({
      selectedCopilotModels: {
        'commit-message-generation': encodeModelKey({
          kind: 'copilot',
          modelId: DefaultCopilotModel,
        }),
      },
      onSelectedCopilotModelChanged: (f, m) =>
        changed.push({ feature: f, model: m }),
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    const autoOption = Array.from(select.options).find(
      option => option.textContent === 'Auto'
    )

    assert.ok(autoOption)
    fireEvent.change(select, { target: { value: autoOption.value } })
    assert.deepStrictEqual(changed, [
      {
        feature: 'commit-message-generation',
        model: null,
      },
    ])
  })

  it('falls back to the default Copilot model when persisted selection is not in the model list', async () => {
    const view = await renderCopilotPreferences({
      selectedCopilotModels: {
        'commit-message-generation': 'deleted-model',
      },
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    assert.strictEqual(
      select.value,
      encodeModelKey({ kind: 'copilot', modelId: DefaultCopilotModel })
    )
  })

  it('falls back to the default Copilot model when the BYOK provider for the persisted selection is gone', async () => {
    const view = await renderCopilotPreferences({
      selectedCopilotModels: {
        'commit-message-generation': encodeModelKey({
          kind: 'byok',
          providerId: 'missing-provider',
          modelId: 'llama3',
        }),
      },
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    assert.strictEqual(
      select.value,
      encodeModelKey({ kind: 'copilot', modelId: DefaultCopilotModel })
    )
  })

  it('falls back to the first available Copilot model when DefaultCopilotModel is unavailable', async () => {
    const onlyOtherModel = [otherModel]
    const view = await renderCopilotPreferences({
      copilotModels: onlyOtherModel,
      selectedCopilotModels: {
        'commit-message-generation': 'deleted-model',
      },
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    assert.strictEqual(
      select.value,
      encodeModelKey({ kind: 'copilot', modelId: otherModel.id })
    )
  })

  it('falls back to the first BYOK model when no Copilot models are available', async () => {
    const view = await renderCopilotPreferences({
      copilotModels: [],
      byokProviders: [ollamaProvider],
      selectedCopilotModels: {
        'commit-message-generation': 'deleted-model',
      },
    })
    const select = view.container.querySelector('select') as HTMLSelectElement
    assert.strictEqual(
      select.value,
      encodeModelKey({
        kind: 'byok',
        providerId: ollamaProvider.id,
        modelId: ollamaProvider.models[0].id,
      })
    )
  })

  it('hides the Providers tab when showBYOKSettings is false', async () => {
    const view = await renderCopilotPreferences()
    const tabs = view.container.querySelectorAll('[role="tab"]')
    assert.strictEqual(tabs.length, 0)
  })

  it('shows the Providers tab when enabled', async () => {
    const view = await renderCopilotPreferences({ showBYOKSettings: true })
    const tabs = view.container.querySelectorAll('[role="tab"]')
    const providersTab = Array.from(tabs).find(t =>
      (t.textContent ?? '').toLowerCase().includes('providers')
    )
    assert.ok(providersTab)
  })

  it('invokes onAddBYOKProvider when the Add button is clicked', async () => {
    let called = 0
    const view = await renderCopilotPreferences({
      showBYOKSettings: true,
      onAddBYOKProvider: () => {
        called += 1
      },
    })
    const tabs = view.container.querySelectorAll('[role="tab"]')
    const providersTab = Array.from(tabs).find(t =>
      (t.textContent ?? '').toLowerCase().includes('providers')
    )
    assert.ok(providersTab)
    fireEvent.click(providersTab!)
    const buttons = view.container.querySelectorAll('button')
    const addButton = Array.from(buttons).find(b =>
      (b.textContent ?? '').toLowerCase().includes('add provider')
    )
    assert.ok(addButton)
    fireEvent.click(addButton!)
    assert.strictEqual(called, 1)
  })

  describe('conflict resolution model picker', () => {
    const previousPreviewFeatures = process.env.GITHUB_DESKTOP_PREVIEW_FEATURES

    async function withConflictResolutionEnabled(
      enabled: boolean,
      fn: () => Promise<void>
    ) {
      if (enabled) {
        process.env.GITHUB_DESKTOP_PREVIEW_FEATURES = '1'
      } else {
        delete process.env.GITHUB_DESKTOP_PREVIEW_FEATURES
      }
      try {
        await fn()
      } finally {
        if (previousPreviewFeatures === undefined) {
          delete process.env.GITHUB_DESKTOP_PREVIEW_FEATURES
        } else {
          process.env.GITHUB_DESKTOP_PREVIEW_FEATURES = previousPreviewFeatures
        }
      }
    }

    it('is hidden when the feature flag is disabled', async () => {
      await withConflictResolutionEnabled(false, async () => {
        const view = await renderCopilotPreferences()
        const selects = view.container.querySelectorAll('select')
        assert.strictEqual(selects.length, 1)
      })
    })

    it('renders a second picker when the feature flag is enabled', async () => {
      await withConflictResolutionEnabled(true, async () => {
        const view = await renderCopilotPreferences()
        const selects = view.container.querySelectorAll('select')
        assert.strictEqual(selects.length, 2)
      })
    })

    it('emits the conflict-resolution feature on change', async () => {
      await withConflictResolutionEnabled(true, async () => {
        const changed: Array<{
          feature: CopilotFeature
          model: string | null
        }> = []
        const view = await renderCopilotPreferences({
          onSelectedCopilotModelChanged: (f, m) =>
            changed.push({ feature: f, model: m }),
        })
        const selects = view.container.querySelectorAll('select')
        const conflictSelect = selects[1] as HTMLSelectElement
        fireEvent.change(conflictSelect, {
          target: {
            value: encodeModelKey({
              kind: 'copilot',
              modelId: 'claude-sonnet',
            }),
          },
        })
        assert.deepStrictEqual(changed, [
          {
            feature: 'conflict-resolution',
            model: encodeModelKey({
              kind: 'copilot',
              modelId: 'claude-sonnet',
            }),
          },
        ])
      })
    })
  })
})
