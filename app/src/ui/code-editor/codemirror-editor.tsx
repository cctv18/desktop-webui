import * as React from 'react'
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  deleteLine,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState, Extension, Range } from '@codemirror/state'
import {
  Decoration,
  type DOMEventHandlers,
  EditorView,
  ViewUpdate,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { css } from '@codemirror/lang-css'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { ApplicationTheme } from '../lib/application-theme'
import {
  type CodeEditorLanguage,
  detectLanguageFromPathAndContent,
  findSearchMatches,
  ICodeEditorSearchMatch,
  ICodeEditorSearchOptions,
} from './code-editor-model'

interface ICodeMirrorEditorProps {
  readonly value: string
  readonly relativePath: string | null
  readonly stateStorageKey: string
  readonly searchQuery: string
  readonly searchOptions: ICodeEditorSearchOptions
  readonly searchMatches: ReadonlyArray<ICodeEditorSearchMatch>
  readonly activeSearchMatchIndex: number
  readonly fontSize: number
  readonly lineWrapping: boolean
  readonly theme: ApplicationTheme
  readonly onChange: (value: string) => void
  readonly onSave: () => void
  readonly onSearch: () => void
}

export class CodeMirrorEditor extends React.Component<ICodeMirrorEditorProps> {
  private readonly containerRef = React.createRef<HTMLDivElement>()
  private readonly languageCompartment = new Compartment()
  private readonly preferencesCompartment = new Compartment()
  private readonly searchCompartment = new Compartment()
  private view: EditorView | null = null
  private ignoreNextUpdate = false

  public componentDidMount() {
    const parent = this.containerRef.current
    if (parent === null) {
      return
    }

    this.view = new EditorView({
      parent,
      state: this.createEditorState(),
    })

    this.focusActiveMatch()
  }

  public componentDidUpdate(previousProps: ICodeMirrorEditorProps) {
    if (this.view === null) {
      return
    }

    if (previousProps.stateStorageKey !== this.props.stateStorageKey) {
      this.writeCachedEditorState(previousProps.stateStorageKey)
      this.view.setState(this.createEditorState())
      this.focusActiveMatch()
      return
    }

    if (
      previousProps.relativePath !== this.props.relativePath ||
      previousProps.value !== this.props.value
    ) {
      const currentValue = this.view.state.doc.toString()
      if (currentValue !== this.props.value) {
        this.ignoreNextUpdate = true
        this.view.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: this.props.value,
          },
        })
        this.writeCachedEditorState()
      }
    }

    if (
      getLanguage(previousProps.relativePath, previousProps.value) !==
      getLanguage(this.props.relativePath, this.props.value)
    ) {
      this.view.dispatch({
        effects: this.languageCompartment.reconfigure(
          getLanguageExtension(
            getLanguage(this.props.relativePath, this.props.value)
          )
        ),
      })
    }

    if (
      previousProps.fontSize !== this.props.fontSize ||
      previousProps.lineWrapping !== this.props.lineWrapping ||
      previousProps.theme !== this.props.theme
    ) {
      this.view.dispatch({
        effects: this.preferencesCompartment.reconfigure(
          getPreferenceExtensions(
            this.props.fontSize,
            this.props.lineWrapping,
            this.props.theme
          )
        ),
      })
    }

    const searchConfigurationChanged =
      previousProps.searchQuery !== this.props.searchQuery ||
      previousProps.searchOptions !== this.props.searchOptions
    const activeSearchMatchChanged =
      previousProps.activeSearchMatchIndex !== this.props.activeSearchMatchIndex

    if (searchConfigurationChanged || activeSearchMatchChanged) {
      this.view.dispatch({
        effects: this.searchCompartment.reconfigure(
          getSearchHighlightExtension(
            this.props.searchQuery,
            this.props.searchOptions,
            this.props.activeSearchMatchIndex
          )
        ),
      })
    }

    if (activeSearchMatchChanged && !searchConfigurationChanged) {
      this.focusActiveMatch()
    }
  }

  public componentWillUnmount() {
    this.writeCachedEditorState()
    this.view?.destroy()
    this.view = null
  }

  public focus() {
    this.view?.focus()
  }

  public focusActiveMatch() {
    const view = this.view
    if (view === null) {
      return
    }

    const match = this.props.searchMatches[this.props.activeSearchMatchIndex]
    if (match === undefined) {
      return
    }

    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    })
    view.focus()
  }

  public render() {
    return <div className="code-editor-codemirror" ref={this.containerRef} />
  }

  private getExtensions(): ReadonlyArray<Extension> {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      EditorView.domEventHandlers(disabledDragDropHandlers),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            this.props.onSave()
            return true
          },
        },
        {
          key: 'Mod-f',
          run: () => {
            this.props.onSearch()
            return true
          },
        },
        { key: 'Mod-d', run: deleteLine },
        indentWithTab,
        ...closeBracketsKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of(this.onEditorUpdated),
      this.languageCompartment.of(
        getLanguageExtension(
          getLanguage(this.props.relativePath, this.props.value)
        )
      ),
      this.preferencesCompartment.of(
        getPreferenceExtensions(
          this.props.fontSize,
          this.props.lineWrapping,
          this.props.theme
        )
      ),
      this.searchCompartment.of(
        getSearchHighlightExtension(
          this.props.searchQuery,
          this.props.searchOptions,
          this.props.activeSearchMatchIndex
        )
      ),
    ]
  }

  private onEditorUpdated = (update: ViewUpdate) => {
    if (!update.docChanged) {
      return
    }

    if (this.ignoreNextUpdate) {
      this.ignoreNextUpdate = false
      this.writeCachedEditorState()
      return
    }

    this.props.onChange(update.state.doc.toString())
    this.writeCachedEditorState()
  }

  private createEditorState() {
    const cachedState = readCachedEditorState(this.props.stateStorageKey)
    const extensions = this.getExtensions()

    if (cachedState !== null) {
      try {
        const state = EditorState.fromJSON(
          cachedState,
          { extensions },
          { history: historyField }
        )

        if (state.doc.toString() === this.props.value) {
          return state
        }
      } catch {
        removeCachedEditorState(this.props.stateStorageKey)
      }
    }

    return EditorState.create({
      doc: this.props.value,
      extensions,
    })
  }

  private writeCachedEditorState(key = this.props.stateStorageKey) {
    if (this.view === null) {
      return
    }

    writeCachedEditorState(
      key,
      this.view.state.toJSON({ history: historyField })
    )
  }
}

const disabledDragDropHandlers: DOMEventHandlers<unknown> = {
  dragstart: event => {
    event.preventDefault()
    return true
  },
  drop: event => {
    event.preventDefault()
    return true
  },
}

function getPreferenceExtensions(
  fontSize: number,
  lineWrapping: boolean,
  theme: ApplicationTheme
) {
  const baseTheme = EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--background-color)',
        color: 'var(--text-color)',
        fontSize: `${fontSize}px`,
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-family-monospace)',
        overflow: 'auto',
        maxWidth: '100%',
      },
      '.cm-content': {
        caretColor: 'var(--text-color)',
        fontFamily: 'var(--font-family-monospace)',
        userSelect: 'text',
      },
      '.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        {
          backgroundColor:
            theme === ApplicationTheme.Dark
              ? 'rgba(255, 209, 102, 0.45) !important'
              : 'rgba(0, 95, 184, 0.28) !important',
        },
      '.cm-line': {
        fontFamily: 'var(--font-family-monospace)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--box-alt-background-color)',
        borderColor: 'var(--box-border-color)',
        color: 'var(--text-secondary-color)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--list-item-hover-background-color)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--list-item-hover-background-color)',
      },
      '.cm-code-editor-search-match': {
        backgroundColor: '#fff176',
        color: '#111111',
        outline: '1px solid #f9a825',
      },
      '.cm-code-editor-search-current': {
        backgroundColor: '#ffb74d',
        color: '#111111',
        outline: '1px solid #ef6c00',
      },
      '.cm-code-editor-patch-added': {
        backgroundColor: 'var(--diff-add-background-color)',
        color: 'var(--diff-add-text-color)',
      },
      '.cm-code-editor-patch-removed': {
        backgroundColor: 'var(--diff-delete-background-color)',
        color: 'var(--diff-delete-text-color)',
      },
      '.cm-code-editor-patch-hunk': {
        backgroundColor: 'var(--diff-hunk-background-color)',
        color: 'var(--diff-hunk-text-color)',
      },
    },
    { dark: theme === ApplicationTheme.Dark }
  )

  const extensions: Extension[] = [baseTheme]
  if (theme === ApplicationTheme.Dark) {
    extensions.push(oneDark)
  }
  if (lineWrapping) {
    extensions.push(EditorView.lineWrapping)
  }

  return extensions
}

function getSearchHighlightExtension(
  query: string,
  options: ICodeEditorSearchOptions,
  activeIndex: number
) {
  return EditorView.decorations.compute(['doc'], state => {
    const matches = findSearchMatches(state.doc.toString(), query, options)
    return Decoration.set(
      matches.map((match, index) =>
        Decoration.mark({
          class:
            index === activeIndex
              ? 'cm-code-editor-search-current'
              : 'cm-code-editor-search-match',
        }).range(match.from, match.to)
      )
    )
  })
}

function getLanguage(
  relativePath: string | null,
  contents: string
): CodeEditorLanguage {
  return detectLanguageFromPathAndContent(relativePath, contents)
}

function getLanguageExtension(language: CodeEditorLanguage): Extension {
  switch (language) {
    case 'javascript':
      return javascript({ typescript: true, jsx: true })
    case 'json':
      return json()
    case 'html':
      return html()
    case 'css':
      return css()
    case 'markdown':
      return markdown()
    case 'patch':
      return patchLineHighlightExtension
    case 'python':
      return python()
    case 'cpp':
      return cpp()
    case 'java':
      return java()
    case 'go':
      return go()
    case 'rust':
      return rust()
    case 'yaml':
      return yaml()
    case 'unknown':
      return []
  }
}

const patchLineHighlightExtension = EditorView.decorations.compute(
  ['doc'],
  state => {
    const decorations = new Array<Range<Decoration>>()

    for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
      const line = state.doc.line(lineNumber)
      const text = line.text

      if (text.startsWith('@@')) {
        decorations.push(
          Decoration.line({ class: 'cm-code-editor-patch-hunk' }).range(
            line.from
          )
        )
      } else if (text.startsWith('+') && !text.startsWith('+++')) {
        decorations.push(
          Decoration.line({ class: 'cm-code-editor-patch-added' }).range(
            line.from
          )
        )
      } else if (text.startsWith('-') && !text.startsWith('---')) {
        decorations.push(
          Decoration.line({ class: 'cm-code-editor-patch-removed' }).range(
            line.from
          )
        )
      }
    }

    return Decoration.set(decorations)
  }
)

function readCachedEditorState(key: string): unknown | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeCachedEditorState(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota errors. The editor still keeps its in-memory history.
  }
}

function removeCachedEditorState(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Ignore storage errors while recovering from stale cached state.
  }
}
