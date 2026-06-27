import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { IRepositoryState } from '../../lib/app-state'
import { TipState } from '../../models/tip'
import { ApplicationTheme } from '../lib/application-theme'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TabBar, TabBarType } from '../tab-bar'
import {
  buildFileTreeFromPaths,
  CodeEditorLineEnding,
  CodeEditorTreeNode,
  createSideBySideDiffRows,
  defaultCodeEditorIgnoredPaths,
  detectLineEnding,
  findSearchMatches,
  ICodeEditorSideBySideDiffRow,
  ICodeEditorSearchMatch,
  ICodeEditorSearchOptions,
  normalizeEditorText,
  parseIgnoredPathList,
  replaceAllSearchMatches,
  replaceSearchMatch,
  serializeIgnoredPathList,
} from './code-editor-model'
import {
  activateRepositoryEditorBranchCache,
  createRepositoryCodeEditorDiff,
  listRepositoryFiles,
  readRepositoryConflictTextFile,
  readRepositoryTempFileStatus,
  readRepositoryTextFile,
  removeRepositoryConflictTextFile,
  removeRepositoryTempTextFile,
  writeRepositoryTempTextFile,
  writeRepositoryTextFile,
} from './code-editor-files'
import { CodeMirrorEditor } from './codemirror-editor'
import {
  ICodeEditorDiffResult,
  ICodeEditorConflictFile,
  purgeLegacyCodeEditorStorage,
  readCodeEditorStorageItem,
  writeCodeEditorStorageItem,
} from './code-editor-storage'

export interface ICodeEditorOpenFileRequest {
  readonly id: number
  readonly relativePath: string
}

interface ICodeEditorPanelProps {
  readonly repository: Repository
  readonly repositoryState: IRepositoryState
  readonly dispatcher: Dispatcher
  readonly currentTheme: ApplicationTheme
  readonly openFileRequest: ICodeEditorOpenFileRequest | null
  readonly onOpenFileRequestHandled: (id: number) => void
}

interface ICodeEditorConflictDraft extends ICodeEditorConflictFile {
  readonly contents: string
  readonly lineEnding: CodeEditorLineEnding
}

interface ICodeEditorPreferences {
  readonly fontSize: number
  readonly lineWrapping: boolean
  readonly diffMode: CodeEditorDiffMode
  readonly ignoredPaths: ReadonlyArray<string>
  readonly showIgnoredPaths: boolean
}

type CodeEditorDiffMode = 'unified' | 'split'

interface ICodeEditorSession {
  readonly selectedPath: string | null
  readonly expandedDirectoryPaths: ReadonlyArray<string>
  readonly treeVisible: boolean
  readonly activeTab: 'edit' | 'preview'
}

interface ICodeEditorPanelState {
  readonly fileTree: ReadonlyArray<CodeEditorTreeNode>
  readonly expandedDirectoryPaths: ReadonlySet<string>
  readonly selectedPath: string | null
  readonly diskContents: string
  readonly editorContents: string
  readonly lineEnding: CodeEditorLineEnding
  readonly activeTab: 'edit' | 'preview'
  readonly previewDiffLoading: boolean
  readonly previewDiffResult: ICodeEditorDiffResult | null
  readonly previewDiffError: string | null
  readonly searchQuery: string
  readonly replacement: string
  readonly searchOptions: ICodeEditorSearchOptions
  readonly activeSearchMatchIndex: number
  readonly conflictDraft: ICodeEditorConflictDraft | null
  readonly conflictComparisonVisible: boolean
  readonly ignoreSettingsVisible: boolean
  readonly ignoredPathListText: string
  readonly treeVisible: boolean
  readonly loadingTree: boolean
  readonly loadingFile: boolean
  readonly saving: boolean
  readonly error: string | null
  readonly preferences: ICodeEditorPreferences
}

const editorPreferenceKey = 'gitdesk-webui:code-editor:preferences'
const editorSessionStoragePrefix = 'gitdesk-webui:code-editor:session:'

export class CodeEditorPanel extends React.Component<
  ICodeEditorPanelProps,
  ICodeEditorPanelState
> {
  private readonly editorRef = React.createRef<CodeMirrorEditor>()
  private searchInput: HTMLInputElement | null = null
  private lastOpenRequestID: number | null = null
  private isMounted = false
  private previewDiffRequestID = 0

  public constructor(props: ICodeEditorPanelProps) {
    super(props)

    const preferences = getDefaultPreferences()
    const session = getDefaultSession()

    this.state = {
      fileTree: [],
      expandedDirectoryPaths: new Set(session.expandedDirectoryPaths),
      selectedPath: session.selectedPath,
      diskContents: '',
      editorContents: '',
      lineEnding: 'lf',
      activeTab: session.activeTab,
      previewDiffLoading: false,
      previewDiffResult: null,
      previewDiffError: null,
      searchQuery: '',
      replacement: '',
      searchOptions: {
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
      },
      activeSearchMatchIndex: 0,
      conflictDraft: null,
      conflictComparisonVisible: false,
      ignoreSettingsVisible: false,
      ignoredPathListText: serializeIgnoredPathList(preferences.ignoredPaths),
      treeVisible: session.treeVisible,
      loadingTree: false,
      loadingFile: false,
      saving: false,
      error: null,
      preferences,
    }
  }

  public componentDidMount() {
    this.isMounted = true
    void this.initialize()
  }

  public componentDidUpdate(previousProps: ICodeEditorPanelProps) {
    if (
      previousProps.repository.path !== this.props.repository.path ||
      getBranchKey(previousProps.repositoryState) !==
        getBranchKey(this.props.repositoryState)
    ) {
      void this.handleRepositoryContextChanged(previousProps)
      return
    }

    this.openRequestedFileIfNeeded()
  }

  public componentWillUnmount() {
    this.isMounted = false
    void this.persistTempFileIfNeeded()
    this.persistSession()
  }

  public render() {
    return (
      <div id="code-editor-panel">
        {this.renderSidebar()}
        <div className="code-editor-main">
          {this.renderHeader()}
          {this.renderBody()}
        </div>
      </div>
    )
  }

  private renderSidebar() {
    if (!this.state.treeVisible) {
      return null
    }

    return (
      <div className="code-editor-sidebar">
        <div className="code-editor-sidebar-header">
          <span>Files</span>
          <div className="code-editor-sidebar-buttons">
            <button
              type="button"
              className="code-editor-icon-button"
              onClick={this.toggleIgnoreSettingsVisible}
              title="File tree options"
            >
              <Octicon symbol={octicons.gear} />
            </button>
            <button
              type="button"
              className="code-editor-icon-button"
              onClick={this.toggleTreeVisible}
              title="Hide file tree"
            >
              <Octicon symbol={octicons.sidebarExpand} />
            </button>
          </div>
        </div>
        {this.renderIgnoreSettings()}
        <div className="code-editor-file-tree">
          {this.state.loadingTree ? (
            <div className="code-editor-empty">Loading files...</div>
          ) : (
            this.renderTreeNodes(this.state.fileTree, 0)
          )}
        </div>
      </div>
    )
  }

  private renderIgnoreSettings() {
    if (!this.state.ignoreSettingsVisible) {
      return null
    }

    return (
      <div className="code-editor-ignore-settings">
        <label>
          <input
            type="checkbox"
            checked={this.state.preferences.showIgnoredPaths}
            onChange={this.onShowIgnoredPathsChanged}
          />
          <span>Show ignored paths</span>
        </label>
        <label>
          <span>Ignored paths</span>
          <textarea
            value={this.state.ignoredPathListText}
            spellCheck={false}
            onChange={this.onIgnoredPathListChanged}
          />
        </label>
      </div>
    )
  }

  private renderHeader() {
    const selectedPath = this.state.selectedPath
    const matches = this.getSearchMatches()
    const dirty = this.isDirty()

    return (
      <div className="code-editor-header">
        <div className="code-editor-title-row">
          {!this.state.treeVisible && (
            <button
              type="button"
              className="code-editor-icon-button"
              onClick={this.toggleTreeVisible}
              title="Show file tree"
            >
              <Octicon symbol={octicons.sidebarCollapse} />
            </button>
          )}
          <div className="code-editor-title">
            {selectedPath ?? this.props.repository.name}
            {dirty ? <span className="code-editor-dirty-dot" /> : null}
            {this.state.previewDiffLoading ? (
              <span className="code-editor-loading-indicator" />
            ) : null}
          </div>
          <div className="code-editor-actions">
            {this.state.conflictDraft !== null &&
            this.state.conflictComparisonVisible ? (
              <>
                <button type="button" onClick={this.restoreConflictDraft}>
                  Restore cache
                </button>
                <button type="button" onClick={this.discardConflictDraft}>
                  Discard cache
                </button>
              </>
            ) : null}
            <button
              type="button"
              disabled={!dirty || this.state.saving}
              onClick={this.save}
            >
              Save
            </button>
            <button
              type="button"
              disabled={!dirty}
              onClick={this.cancelChanges}
            >
              Cancel changes
            </button>
          </div>
        </div>
        <div className="code-editor-controls-row">
          <TabBar
            type={TabBarType.Switch}
            selectedIndex={this.state.activeTab === 'edit' ? 0 : 1}
            onTabClicked={this.onTabClicked}
          >
            <span>Edit</span>
            <span>Preview</span>
          </TabBar>
          <div className="code-editor-preferences">
            <label>
              <span>Line endings</span>
              <select
                value={this.state.lineEnding}
                onChange={this.onLineEndingChanged}
              >
                <option value="lf">LF</option>
                <option value="crlf">CRLF</option>
              </select>
            </label>
            <label>
              <span>Font size</span>
              <input
                type="number"
                min={10}
                max={24}
                value={this.state.preferences.fontSize}
                onChange={this.onFontSizeChanged}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={this.state.preferences.lineWrapping}
                onChange={this.onLineWrappingChanged}
              />
              <span>Wrap</span>
            </label>
          </div>
        </div>
        {this.state.activeTab === 'edit' ? this.renderSearchRow(matches) : null}
        {this.renderConflictPrompt()}
        {this.state.error !== null && (
          <div className="code-editor-error">{this.state.error}</div>
        )}
      </div>
    )
  }

  private renderSearchRow(matches: ReadonlyArray<ICodeEditorSearchMatch>) {
    return (
      <div className="code-editor-search-row">
        <input
          ref={ref => (this.searchInput = ref)}
          type="search"
          placeholder="Search"
          value={this.state.searchQuery}
          onChange={this.onSearchQueryChanged}
        />
        <input
          type="text"
          placeholder="Replace"
          value={this.state.replacement}
          onChange={this.onReplacementChanged}
        />
        <button
          type="button"
          onClick={this.previousMatch}
          disabled={matches.length === 0}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={this.nextMatch}
          disabled={matches.length === 0}
        >
          Next
        </button>
        <button
          type="button"
          onClick={this.replaceOne}
          disabled={matches.length === 0}
        >
          Replace
        </button>
        <button
          type="button"
          onClick={this.replaceAll}
          disabled={matches.length === 0}
        >
          Replace all
        </button>
        <label>
          <input
            type="checkbox"
            checked={this.state.searchOptions.caseSensitive}
            onChange={this.onSearchCaseChanged}
          />
          <span>Case</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={this.state.searchOptions.wholeWord}
            onChange={this.onSearchWholeWordChanged}
          />
          <span>Word</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={this.state.searchOptions.useRegex}
            onChange={this.onSearchRegexChanged}
          />
          <span>Regex</span>
        </label>
        <span className="code-editor-search-count">
          {matches.length === 0
            ? '0 results'
            : `${this.state.activeSearchMatchIndex + 1}/${matches.length}`}
        </span>
      </div>
    )
  }

  private renderConflictPrompt() {
    const conflict = this.state.conflictDraft
    if (conflict === null) {
      return null
    }

    return (
      <div className="code-editor-draft-prompt">
        <span>
          Cached editor changes conflict with the current repository file.
        </span>
        <button type="button" onClick={this.showConflictComparison}>
          Review
        </button>
        <button type="button" onClick={this.restoreConflictDraft}>
          Restore cache
        </button>
        <button type="button" onClick={this.discardConflictDraft}>
          Discard cache
        </button>
      </div>
    )
  }

  private renderBody() {
    if (this.state.selectedPath === null) {
      return (
        <div className="code-editor-empty-state">
          Select a file from the repository tree.
        </div>
      )
    }

    if (this.state.loadingFile) {
      return <div className="code-editor-empty-state">Loading file...</div>
    }

    return (
      <div className="code-editor-body">
        <div
          className={
            this.state.activeTab === 'edit'
              ? 'code-editor-edit-pane active'
              : 'code-editor-edit-pane hidden'
          }
        >
          {this.renderEditor()}
          {this.renderConflictComparison()}
        </div>
        <div
          className={
            this.state.activeTab === 'preview'
              ? 'code-editor-preview-pane active'
              : 'code-editor-preview-pane hidden'
          }
        >
          {this.state.activeTab === 'preview' ? this.renderPreview() : null}
        </div>
      </div>
    )
  }

  private renderEditor() {
    const matches = this.getSearchMatches()

    return (
      <CodeMirrorEditor
        ref={this.editorRef}
        value={this.state.editorContents}
        relativePath={this.state.selectedPath}
        stateCacheKey={createCodeEditorStateCacheKey(
          this.props.repository.path,
          getBranchKey(this.props.repositoryState),
          this.state.selectedPath
        )}
        searchQuery={this.state.searchQuery}
        searchOptions={this.state.searchOptions}
        searchMatches={matches}
        activeSearchMatchIndex={this.state.activeSearchMatchIndex}
        fontSize={this.state.preferences.fontSize}
        lineWrapping={this.state.preferences.lineWrapping}
        theme={this.props.currentTheme}
        onChange={this.onEditorChanged}
        onSave={this.save}
        onSearch={this.focusSearch}
      />
    )
  }

  private renderConflictComparison() {
    const conflict = this.state.conflictDraft

    if (conflict === null || !this.state.conflictComparisonVisible) {
      return null
    }

    const rows = createSideBySideDiffRows(
      this.state.diskContents,
      normalizeEditorText(conflict.contents)
    )

    return (
      <div className="code-editor-conflict-diff">
        <div className="code-editor-split-diff-header">
          <span>Repository file</span>
          <span>Cached edit</span>
        </div>
        <div className="code-editor-split-diff-rows">
          {rows.map((row, index) => this.renderSplitDiffRow(row, index))}
        </div>
      </div>
    )
  }

  private renderPreview() {
    return (
      <div className="code-editor-preview">
        {this.renderPreviewToolbar()}
        {this.renderPreviewContent()}
      </div>
    )
  }

  private renderPreviewContent() {
    if (this.state.previewDiffLoading) {
      return <div className="code-editor-empty-state">Loading diff...</div>
    }

    if (this.state.previewDiffError !== null) {
      return (
        <div className="code-editor-empty-state">
          {this.state.previewDiffError}
        </div>
      )
    }

    const diff = this.state.previewDiffResult
    if (diff === null || diff.mode !== this.state.preferences.diffMode) {
      return <div className="code-editor-empty-state">No diff loaded.</div>
    }

    return diff.mode === 'split'
      ? this.renderSplitDiff(diff)
      : this.renderUnifiedDiff(diff)
  }

  private renderPreviewToolbar() {
    return (
      <div className="code-editor-preview-toolbar">
        <span>Diff view</span>
        <div className="code-editor-segmented-control">
          <button
            type="button"
            className={
              this.state.preferences.diffMode === 'unified'
                ? 'selected'
                : undefined
            }
            onClick={() => this.onDiffModeChanged('unified')}
          >
            Unified
          </button>
          <button
            type="button"
            className={
              this.state.preferences.diffMode === 'split'
                ? 'selected'
                : undefined
            }
            onClick={() => this.onDiffModeChanged('split')}
          >
            Split
          </button>
        </div>
      </div>
    )
  }

  private renderUnifiedDiff(diff: ICodeEditorDiffResult) {
    if (diff.unchanged) {
      return (
        <div className="code-editor-diff-preview unified">
          <div className="code-editor-empty">
            No changes in {diff.relativePath}
          </div>
        </div>
      )
    }

    return (
      <div className="code-editor-diff-preview unified">
        <div className="code-editor-unified-diff-header">
          {diff.relativePath}
          {this.renderDiffTruncationNotice(diff)}
        </div>
        {(diff.rows as ReadonlyArray<any>).map((row, index) =>
          this.renderUnifiedDiffRow(row, index)
        )}
      </div>
    )
  }

  private renderUnifiedDiffRow(
    row: ICodeEditorDiffResult['rows'][number],
    index: number
  ) {
    const line = row as any

    return (
      <div key={index} className={`code-editor-unified-diff-row ${line.kind}`}>
        <span className="line-number">{line.oldLineNumber ?? ''}</span>
        <span className="line-number">{line.newLineNumber ?? ''}</span>
        <pre>
          {line.kind === 'removed' ? line.oldText || ' ' : line.newText || ' '}
        </pre>
      </div>
    )
  }

  private renderSplitDiff(diff: ICodeEditorDiffResult) {
    return (
      <div className="code-editor-split-diff">
        <div className="code-editor-split-diff-header">
          <span>HEAD</span>
          <span>Current</span>
        </div>
        {this.renderDiffTruncationNotice(diff)}
        <div className="code-editor-split-diff-rows">
          {(diff.rows as ReadonlyArray<ICodeEditorSideBySideDiffRow>).map(
            (row, index) => this.renderSplitDiffRow(row, index)
          )}
        </div>
      </div>
    )
  }

  private renderDiffTruncationNotice(diff: ICodeEditorDiffResult) {
    if (!diff.truncated) {
      return null
    }

    return (
      <span className="code-editor-diff-truncated">
        Showing first {diff.rows.length} of {diff.totalRows} rows
      </span>
    )
  }

  private renderSplitDiffRow(row: ICodeEditorSideBySideDiffRow, index: number) {
    return (
      <div key={index} className={`code-editor-split-diff-row ${row.kind}`}>
        <span className="line-number">{row.oldLineNumber ?? ''}</span>
        <pre className="old">{row.oldText || ' '}</pre>
        <span className="line-number">{row.newLineNumber ?? ''}</span>
        <pre className="new">{row.newText || ' '}</pre>
      </div>
    )
  }

  private renderTreeNodes(
    nodes: ReadonlyArray<CodeEditorTreeNode>,
    depth: number
  ): JSX.Element {
    return (
      <>
        {nodes.map(node =>
          node.kind === 'directory'
            ? this.renderDirectory(node, depth)
            : this.renderFile(node, depth)
        )}
      </>
    )
  }

  private renderDirectory(
    node: CodeEditorTreeNode & { kind: 'directory' },
    depth: number
  ) {
    const expanded = this.state.expandedDirectoryPaths.has(node.path)

    return (
      <div key={node.path}>
        <button
          type="button"
          className="code-editor-tree-row directory"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => this.toggleDirectory(node.path)}
        >
          <Octicon
            className="code-editor-tree-toggle"
            symbol={expanded ? octicons.chevronLeft : octicons.chevronRight}
          />
          <Octicon
            symbol={
              expanded
                ? octicons.fileDirectoryOpenFill
                : octicons.fileDirectoryFill
            }
          />
          <span>{node.name}</span>
        </button>
        {expanded ? this.renderTreeNodes(node.children, depth + 1) : null}
      </div>
    )
  }

  private renderFile(
    node: CodeEditorTreeNode & { kind: 'file' },
    depth: number
  ) {
    const selected = this.state.selectedPath === node.path

    return (
      <button
        key={node.path}
        type="button"
        className={`code-editor-tree-row file${selected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => this.openFile(node.path)}
      >
        <Octicon symbol={octicons.fileCode} />
        <span>{node.name}</span>
      </button>
    )
  }

  private refreshRepositoryTree = async () => {
    this.setState({ loadingTree: true, error: null })

    try {
      const files = await listRepositoryFiles(this.props.repository, {
        ignoredPaths: this.state.preferences.ignoredPaths,
        showIgnoredPaths: this.state.preferences.showIgnoredPaths,
      })
      this.setState({
        fileTree: buildFileTreeFromPaths(files),
        loadingTree: false,
      })
    } catch (error) {
      this.setState({
        loadingTree: false,
        error: getErrorMessage(error),
      })
    }
  }

  private openRequestedFileIfNeeded() {
    const request = this.props.openFileRequest
    if (request === null || request.id === this.lastOpenRequestID) {
      return false
    }

    this.lastOpenRequestID = request.id
    this.openFile(request.relativePath)
    this.props.onOpenFileRequestHandled(request.id)
    return true
  }

  private initialize = async () => {
    await purgeLegacyCodeEditorStorage().catch(() => {})
    await activateRepositoryEditorBranchCache(
      this.props.repository,
      getBranchKey(this.props.repositoryState)
    )
    const preferences = await readPreferences()
    const session = await readSession(
      this.props.repository.path,
      getBranchKey(this.props.repositoryState)
    )

    if (!this.isMounted) {
      return
    }

    this.setState(
      {
        preferences,
        ignoredPathListText: serializeIgnoredPathList(preferences.ignoredPaths),
        expandedDirectoryPaths: new Set(session.expandedDirectoryPaths),
        selectedPath: session.selectedPath,
        activeTab: session.activeTab,
        treeVisible: session.treeVisible,
      },
      () => {
        this.refreshRepositoryTree()
        if (
          !this.openRequestedFileIfNeeded() &&
          this.state.selectedPath !== null
        ) {
          this.openFile(this.state.selectedPath)
        }
      }
    )
  }

  private handleRepositoryContextChanged = async (
    previousProps: ICodeEditorPanelProps
  ) => {
    await this.persistTempFileIfNeeded(previousProps)
    await activateRepositoryEditorBranchCache(
      this.props.repository,
      getBranchKey(this.props.repositoryState)
    )
    const session = await readSession(
      this.props.repository.path,
      getBranchKey(this.props.repositoryState)
    )

    if (!this.isMounted) {
      return
    }

    this.setState(
      {
        expandedDirectoryPaths: new Set(session.expandedDirectoryPaths),
        selectedPath: session.selectedPath,
        diskContents: '',
        editorContents: '',
        conflictDraft: null,
        conflictComparisonVisible: false,
        previewDiffLoading: false,
        previewDiffResult: null,
        previewDiffError: null,
        activeTab: session.activeTab,
        treeVisible: session.treeVisible,
        activeSearchMatchIndex: 0,
      },
      () => {
        this.refreshRepositoryTree()
        if (
          !this.openRequestedFileIfNeeded() &&
          this.state.selectedPath !== null
        ) {
          this.openFile(this.state.selectedPath)
        }
      }
    )
  }

  private openFile = async (relativePath: string) => {
    if (this.state.selectedPath !== relativePath) {
      await this.persistTempFileIfNeeded()
    }

    this.setState({
      selectedPath: relativePath,
      loadingFile: true,
      error: null,
      activeTab: 'edit',
      conflictDraft: null,
      conflictComparisonVisible: false,
      previewDiffLoading: false,
      previewDiffResult: null,
      previewDiffError: null,
    })

    try {
      log.info(`[CodeEditor] open file path='${relativePath}'`)
      const rawContents = await readRepositoryTextFile(
        this.props.repository,
        relativePath
      )
      const diskLineEnding = detectLineEnding(
        rawContents,
        getSystemDefaultLineEnding()
      )
      const diskContents = normalizeEditorText(rawContents)
      const tempFileStatus = await readRepositoryTempFileStatus(
        this.props.repository,
        getBranchKey(this.props.repositoryState),
        relativePath,
        diskContents
      )
      const tempContents =
        tempFileStatus.hasTempFile && tempFileStatus.contents !== null
          ? normalizeEditorText(tempFileStatus.contents)
          : null
      const conflictDraft =
        tempFileStatus.conflict === null
          ? null
          : {
              ...tempFileStatus.conflict,
              contents: normalizeEditorText(tempFileStatus.conflict.contents),
            }

      this.expandParents(relativePath)
      this.setState(
        {
          diskContents,
          editorContents: tempContents ?? diskContents,
          lineEnding: tempFileStatus.lineEnding ?? diskLineEnding,
          conflictDraft,
          conflictComparisonVisible: false,
          loadingFile: false,
          activeSearchMatchIndex: 0,
        },
        () => this.persistSession()
      )
    } catch (error) {
      this.setState({
        loadingFile: false,
        error: getErrorMessage(error),
      })
    }
  }

  private expandParents(relativePath: string) {
    const parts = relativePath.split('/')
    if (parts.length < 2) {
      return
    }

    const expanded = new Set(this.state.expandedDirectoryPaths)
    for (let index = 1; index < parts.length; index++) {
      expanded.add(parts.slice(0, index).join('/'))
    }
    this.setState({ expandedDirectoryPaths: expanded }, () =>
      this.persistSession()
    )
  }

  private toggleDirectory = (path: string) => {
    const expanded = new Set(this.state.expandedDirectoryPaths)
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
    }
    this.setState({ expandedDirectoryPaths: expanded }, () =>
      this.persistSession()
    )
  }

  private toggleTreeVisible = () => {
    this.setState(
      state => ({ treeVisible: !state.treeVisible }),
      () => this.persistSession()
    )
  }

  private toggleIgnoreSettingsVisible = () => {
    this.setState(state => ({
      ignoreSettingsVisible: !state.ignoreSettingsVisible,
    }))
  }

  private onTabClicked = (tab: number) => {
    const activeTab = tab === 0 ? 'edit' : 'preview'
    log.info(`[CodeEditor] switch tab tab='${activeTab}'`)
    this.setState({ activeTab }, () => {
      this.persistSession()
      if (activeTab === 'preview') {
        void this.loadPreviewDiff('tab-switch')
      }
    })
  }

  private onEditorChanged = (contents: string) => {
    const previousContents = this.state.editorContents
    this.setState({ editorContents: contents, previewDiffResult: null }, () => {
      void this.persistTempFileIfNeeded(undefined, previousContents)
    })
  }

  private save = async () => {
    const selectedPath = this.state.selectedPath
    if (selectedPath === null || !this.isDirty()) {
      return
    }

    this.setState({ saving: true, error: null })

    try {
      log.info(`[CodeEditor] save file path='${selectedPath}'`)
      await writeRepositoryTextFile(
        this.props.repository,
        selectedPath,
        this.state.editorContents,
        this.state.lineEnding
      )
      await removeRepositoryTempTextFile(
        this.props.repository,
        getBranchKey(this.props.repositoryState),
        selectedPath
      )
      this.setState({
        diskContents: this.state.editorContents,
        saving: false,
        conflictDraft: null,
        conflictComparisonVisible: false,
        previewDiffResult: null,
        previewDiffError: null,
      })
      await this.props.dispatcher.refreshRepository(this.props.repository)
    } catch (error) {
      this.setState({
        saving: false,
        error: getErrorMessage(error),
      })
    }
  }

  private cancelChanges = () => {
    const selectedPath = this.state.selectedPath
    if (selectedPath !== null) {
      log.info(`[CodeEditor] cancel changes path='${selectedPath}'`)
      void removeRepositoryTempTextFile(
        this.props.repository,
        getBranchKey(this.props.repositoryState),
        selectedPath
      )
    }

    this.setState({
      editorContents: this.state.diskContents,
      conflictDraft: null,
      conflictComparisonVisible: false,
      previewDiffResult: null,
      previewDiffError: null,
      activeSearchMatchIndex: 0,
    })
  }

  private showConflictComparison = () => {
    this.setState({ conflictComparisonVisible: true, activeTab: 'edit' })
  }

  private restoreConflictDraft = async () => {
    const conflict = this.state.conflictDraft
    const selectedPath = this.state.selectedPath
    if (conflict === null || selectedPath === null) {
      return
    }

    const latestConflict =
      (await readRepositoryConflictTextFile(
        this.props.repository,
        getBranchKey(this.props.repositoryState),
        selectedPath,
        conflict.id
      ).catch(() => null)) ?? conflict
    const contents = normalizeEditorText(latestConflict.contents)

    this.setState(
      {
        editorContents: contents,
        lineEnding: latestConflict.lineEnding,
        conflictDraft: null,
        conflictComparisonVisible: false,
      },
      () => {
        void this.persistTempFileIfNeeded(undefined, this.state.diskContents)
      }
    )

    await removeRepositoryConflictTextFile(
      this.props.repository,
      getBranchKey(this.props.repositoryState),
      selectedPath,
      conflict.id
    )
  }

  private discardConflictDraft = async () => {
    const conflict = this.state.conflictDraft
    const selectedPath = this.state.selectedPath
    if (selectedPath !== null && conflict !== null) {
      await removeRepositoryConflictTextFile(
        this.props.repository,
        getBranchKey(this.props.repositoryState),
        selectedPath,
        conflict.id
      )
    }
    this.setState({ conflictDraft: null, conflictComparisonVisible: false })
  }

  private async persistTempFileIfNeeded(
    props: ICodeEditorPanelProps = this.props,
    previousContents = this.state.editorContents
  ) {
    const selectedPath = this.state.selectedPath
    if (selectedPath === null) {
      return
    }

    if (!this.isDirty()) {
      await removeRepositoryTempTextFile(
        props.repository,
        getBranchKey(props.repositoryState),
        selectedPath
      )
      return
    }

    await writeRepositoryTempTextFile(props.repository, {
      branchKey: getBranchKey(props.repositoryState),
      relativePath: selectedPath,
      contents: this.state.editorContents,
      previousContents,
      baseContents: this.state.diskContents,
      lineEnding: this.state.lineEnding,
    })
  }

  private async loadPreviewDiff(reason: string) {
    const selectedPath = this.state.selectedPath
    if (selectedPath === null) {
      return
    }

    const requestID = ++this.previewDiffRequestID
    const mode = this.state.preferences.diffMode
    const startedAt = performance.now()

    log.info(
      `[CodeEditor] preview diff requested reason='${reason}' path='${selectedPath}' mode='${mode}'`
    )

    this.setState({
      previewDiffLoading: true,
      previewDiffError: null,
      previewDiffResult: null,
    })

    try {
      await this.persistTempFileIfNeeded()
      const diff = await createRepositoryCodeEditorDiff(
        this.props.repository,
        getBranchKey(this.props.repositoryState),
        selectedPath,
        mode
      )

      if (!this.isMounted || requestID !== this.previewDiffRequestID) {
        return
      }

      log.info(
        `[CodeEditor] preview diff loaded path='${selectedPath}' mode='${mode}' rows=${
          diff.totalRows
        } durationMs=${Math.round(performance.now() - startedAt)}`
      )

      this.setState({
        previewDiffLoading: false,
        previewDiffResult: diff,
        previewDiffError: null,
      })
    } catch (error) {
      if (!this.isMounted || requestID !== this.previewDiffRequestID) {
        return
      }

      log.warn(
        `[CodeEditor] preview diff failed path='${selectedPath}' mode='${mode}'`,
        error
      )

      this.setState({
        previewDiffLoading: false,
        previewDiffResult: null,
        previewDiffError: getErrorMessage(error),
      })
    }
  }

  private isDirty() {
    return this.state.editorContents !== this.state.diskContents
  }

  private getSearchMatches() {
    return findSearchMatches(
      this.state.editorContents,
      this.state.searchQuery,
      this.state.searchOptions
    )
  }

  private onSearchQueryChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({
      searchQuery: event.currentTarget.value,
      activeSearchMatchIndex: 0,
    })
  }

  private onReplacementChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ replacement: event.currentTarget.value })
  }

  private previousMatch = () => {
    const count = this.getSearchMatches().length
    if (count === 0) {
      return
    }
    this.setState(state => ({
      activeSearchMatchIndex:
        (state.activeSearchMatchIndex - 1 + count) % count,
    }))
  }

  private nextMatch = () => {
    const count = this.getSearchMatches().length
    if (count === 0) {
      return
    }
    this.setState(state => ({
      activeSearchMatchIndex: (state.activeSearchMatchIndex + 1) % count,
    }))
  }

  private replaceOne = () => {
    const matches = this.getSearchMatches()
    const match = matches[this.state.activeSearchMatchIndex] ?? matches[0]
    if (match === undefined) {
      return
    }

    this.onEditorChanged(
      replaceSearchMatch(
        this.state.editorContents,
        match,
        this.state.replacement
      )
    )
  }

  private replaceAll = () => {
    const matches = this.getSearchMatches()
    if (matches.length === 0) {
      return
    }

    this.onEditorChanged(
      replaceAllSearchMatches(
        this.state.editorContents,
        matches,
        this.state.replacement
      )
    )
  }

  private focusSearch = () => {
    this.searchInput?.focus()
    this.searchInput?.select()
  }

  private onLineEndingChanged = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const lineEnding = event.currentTarget.value as CodeEditorLineEnding
    this.setState({ lineEnding }, () => void this.persistTempFileIfNeeded())
  }

  private onFontSizeChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fontSize = clampNumber(Number(event.currentTarget.value), 10, 24)
    this.updatePreferences({ ...this.state.preferences, fontSize })
  }

  private onLineWrappingChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.updatePreferences({
      ...this.state.preferences,
      lineWrapping: event.currentTarget.checked,
    })
  }

  private onDiffModeChanged = (diffMode: CodeEditorDiffMode) => {
    log.info(`[CodeEditor] switch diff mode mode='${diffMode}'`)
    this.updatePreferences(
      { ...this.state.preferences, diffMode },
      this.state.activeTab === 'preview'
        ? () => void this.loadPreviewDiff('diff-mode-switch')
        : undefined
    )
  }

  private onShowIgnoredPathsChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.updatePreferences(
      {
        ...this.state.preferences,
        showIgnoredPaths: event.currentTarget.checked,
      },
      this.refreshRepositoryTree
    )
  }

  private onIgnoredPathListChanged = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const ignoredPathListText = event.currentTarget.value
    this.setState({ ignoredPathListText })
    this.updatePreferences(
      {
        ...this.state.preferences,
        ignoredPaths: parseIgnoredPathList(ignoredPathListText),
      },
      this.refreshRepositoryTree
    )
  }

  private onSearchCaseChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({
      searchOptions: {
        ...this.state.searchOptions,
        caseSensitive: event.currentTarget.checked,
      },
      activeSearchMatchIndex: 0,
    })
  }

  private onSearchWholeWordChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({
      searchOptions: {
        ...this.state.searchOptions,
        wholeWord: event.currentTarget.checked,
      },
      activeSearchMatchIndex: 0,
    })
  }

  private onSearchRegexChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({
      searchOptions: {
        ...this.state.searchOptions,
        useRegex: event.currentTarget.checked,
      },
      activeSearchMatchIndex: 0,
    })
  }

  private updatePreferences(
    preferences: ICodeEditorPreferences,
    callback?: () => void
  ) {
    void writeCodeEditorStorageItem(
      editorPreferenceKey,
      JSON.stringify(preferences)
    ).catch(() => {})
    this.setState({ preferences }, callback)
  }

  private persistSession() {
    const session: ICodeEditorSession = {
      selectedPath: this.state.selectedPath,
      expandedDirectoryPaths: Array.from(this.state.expandedDirectoryPaths),
      treeVisible: this.state.treeVisible,
      activeTab: this.state.activeTab,
    }

    void writeCodeEditorStorageItem(
      createCodeEditorSessionKey(
        this.props.repository.path,
        getBranchKey(this.props.repositoryState)
      ),
      JSON.stringify(session)
    ).catch(() => {})
  }
}

function getBranchKey(repositoryState: IRepositoryState) {
  const tip = repositoryState.branchesState.tip
  switch (tip.kind) {
    case TipState.Valid:
      return `tip:${tip.branch.tip.sha}`
    case TipState.Unborn:
      return tip.ref
    case TipState.Detached:
      return `detached:${tip.currentSha}`
    default:
      return 'unknown'
  }
}

function getSystemDefaultLineEnding(): CodeEditorLineEnding {
  return __WIN32__ ? 'crlf' : 'lf'
}

function getDefaultPreferences(): ICodeEditorPreferences {
  return {
    fontSize: 13,
    lineWrapping: false,
    diffMode: 'unified',
    ignoredPaths: defaultCodeEditorIgnoredPaths,
    showIgnoredPaths: false,
  }
}

async function readPreferences(): Promise<ICodeEditorPreferences> {
  const fallback = getDefaultPreferences()
  const raw = await readCodeEditorStorageItem(editorPreferenceKey)
  if (raw === null) {
    return fallback
  }

  try {
    const value = JSON.parse(raw) as Partial<ICodeEditorPreferences>
    return {
      fontSize: clampNumber(
        Number(value.fontSize ?? fallback.fontSize),
        10,
        24
      ),
      lineWrapping: value.lineWrapping === true,
      diffMode: value.diffMode === 'split' ? 'split' : 'unified',
      ignoredPaths: Array.isArray(value.ignoredPaths)
        ? parseIgnoredPathList(value.ignoredPaths.join('\n'))
        : fallback.ignoredPaths,
      showIgnoredPaths: value.showIgnoredPaths === true,
    }
  } catch {
    return fallback
  }
}

function getDefaultSession(): ICodeEditorSession {
  return {
    selectedPath: null,
    expandedDirectoryPaths: [],
    treeVisible: true,
    activeTab: 'edit',
  }
}

async function readSession(
  repositoryPath: string,
  branchName: string
): Promise<ICodeEditorSession> {
  const fallback = getDefaultSession()
  const raw = await readCodeEditorStorageItem(
    createCodeEditorSessionKey(repositoryPath, branchName)
  )
  if (raw === null) {
    return fallback
  }

  try {
    const value = JSON.parse(raw) as Partial<ICodeEditorSession>
    return {
      selectedPath:
        typeof value.selectedPath === 'string' ? value.selectedPath : null,
      expandedDirectoryPaths: Array.isArray(value.expandedDirectoryPaths)
        ? value.expandedDirectoryPaths.filter(path => typeof path === 'string')
        : [],
      treeVisible: value.treeVisible !== false,
      activeTab: value.activeTab === 'preview' ? 'preview' : 'edit',
    }
  } catch {
    return fallback
  }
}

function createCodeEditorSessionKey(
  repositoryPath: string,
  branchName: string
) {
  return `${editorSessionStoragePrefix}${encodeURIComponent(
    JSON.stringify({ repositoryPath, branchName })
  )}`
}

function createCodeEditorStateCacheKey(
  repositoryPath: string,
  branchName: string,
  relativePath: string | null
) {
  return JSON.stringify({ repositoryPath, branchName, relativePath })
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : `${error}`
}
