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
import { Compartment, EditorState, Extension } from '@codemirror/state'
import {
  Decoration,
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
  findSearchMatches,
  ICodeEditorSearchMatch,
  ICodeEditorSearchOptions,
} from './code-editor-model'

interface ICodeMirrorEditorProps {
  readonly value: string
  readonly relativePath: string | null
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
      state: EditorState.create({
        doc: this.props.value,
        extensions: this.getExtensions(),
      }),
    })

    this.focusActiveMatch()
  }

  public componentDidUpdate(previousProps: ICodeMirrorEditorProps) {
    if (this.view === null) {
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
      }
    }

    if (previousProps.relativePath !== this.props.relativePath) {
      this.view.dispatch({
        effects: this.languageCompartment.reconfigure(
          getLanguageExtension(this.props.relativePath)
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

    if (
      previousProps.searchQuery !== this.props.searchQuery ||
      previousProps.searchOptions !== this.props.searchOptions ||
      previousProps.activeSearchMatchIndex !== this.props.activeSearchMatchIndex
    ) {
      this.view.dispatch({
        effects: this.searchCompartment.reconfigure(
          getSearchHighlightExtension(
            this.props.searchQuery,
            this.props.searchOptions,
            this.props.activeSearchMatchIndex
          )
        ),
      })
      this.focusActiveMatch()
    }
  }

  public componentWillUnmount() {
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
        getLanguageExtension(this.props.relativePath)
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
      return
    }

    this.props.onChange(update.state.doc.toString())
  }
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
      },
      '.cm-content': {
        caretColor: 'var(--text-color)',
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
        backgroundColor: 'var(--diff-hunk-background-color)',
        outline: '1px solid var(--diff-hunk-border-color)',
      },
      '.cm-code-editor-search-current': {
        backgroundColor: 'var(--diff-selected-background-color)',
        color: 'var(--diff-selected-text-color)',
        outline: '1px solid var(--diff-selected-border-color)',
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

function getLanguageExtension(relativePath: string | null): Extension {
  if (relativePath === null) {
    return []
  }

  const lower = relativePath.toLowerCase()
  if (/\.(ts|tsx)$/.test(lower)) {
    return javascript({ typescript: true, jsx: lower.endsWith('.tsx') })
  }
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) {
    return javascript({ jsx: lower.endsWith('.jsx') })
  }
  if (lower.endsWith('.json')) {
    return json()
  }
  if (/\.(html|htm)$/.test(lower)) {
    return html()
  }
  if (/\.(css|scss|sass|less)$/.test(lower)) {
    return css()
  }
  if (/\.(md|markdown)$/.test(lower)) {
    return markdown()
  }
  if (lower.endsWith('.py')) {
    return python()
  }
  if (/\.(c|cc|cpp|cxx|h|hpp)$/.test(lower)) {
    return cpp()
  }
  if (lower.endsWith('.java')) {
    return java()
  }
  if (lower.endsWith('.go')) {
    return go()
  }
  if (lower.endsWith('.rs')) {
    return rust()
  }
  if (/\.(yml|yaml)$/.test(lower)) {
    return yaml()
  }

  return []
}
