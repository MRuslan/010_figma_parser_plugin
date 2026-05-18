<script lang="ts">
  import JSZip from 'jszip';
  import { afterUpdate } from 'svelte';
  import type {
    MessageToUI,
    MessageToPlugin,
    FigmaNodeInfo,
    SchemaInfo,
    LogEntry,
    SvgExportItem,
    StructureDumpResult,
  } from '../plugin/types';

  // ─── State ───────────────────────────────────────────────
  let selectionData: FigmaNodeInfo | null = null;
  let schemas: SchemaInfo[] = [];
  let selectedSchemaId = '';
  let logs: LogEntry[] = [];
  let output: string | null = null;
  let svgConfig: string | null = null;
  let svgExports: SvgExportItem[] | null = null;
  let errors: string[] = [];
  let isParsing = false;
  let isDownloading = false;
  let svgExportDone = 0;
  let svgExportTotal = 0;
  let svgExportCurrentName = '';
  let svgPackPercent = 0;
  let svgPhase: 'idle' | 'exporting' | 'packing' | 'done' = 'idle';
  let copiedConfig = false;
  let copiedSvg = false;
  let activeTab: 'config' | 'svg' = 'config';

  // Dev structure dump
  let dumpMaxDepth = 30;
  let dumpUnlimitedDepth = false;
  let dumpIncludeHidden = false;
  let dumpIncludeBBox = true;
  let isDumping = false;
  let structureDump: StructureDumpResult | null = null;
  let structureDumpJson: string | null = null;
  let structureDumpError: string | null = null;
  let copiedDump = false;
  let devSectionOpen = false;

  // ─── Messaging ───────────────────────────────────────────

  function sendMessage(msg: MessageToPlugin): void {
    window.parent.postMessage({ pluginMessage: msg }, '*');
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data?.pluginMessage as MessageToUI | undefined;
    if (!msg) return;

    switch (msg.type) {
      case 'SELECTION_DATA':
        selectionData = msg.data;
        break;

      case 'SCHEMAS_LIST':
        schemas = msg.schemas;
        if (!selectedSchemaId && schemas.length > 0) {
          selectedSchemaId = schemas[0].id;
        }
        break;

      case 'PARSE_PROGRESS':
        logs = [...logs, { step: msg.step, status: msg.status }];
        break;

      case 'PARSE_RESULT':
        output = msg.output;
        svgConfig = msg.svgConfig;
        svgExports = msg.svgExports;
        errors = msg.errors;
        isParsing = false;
        activeTab = 'config';
        break;

      case 'SVG_EXPORT_PROGRESS':
        svgExportDone = msg.done;
        svgExportTotal = msg.total;
        svgExportCurrentName = msg.currentName;
        break;

      case 'SVG_DATA':
        handleSvgData(msg.files);
        break;

      case 'STRUCTURE_DUMP_RESULT':
        isDumping = false;
        structureDump = msg.result;
        structureDumpError = msg.error;
        structureDumpJson = msg.result ? JSON.stringify(msg.result, null, 2) : null;
        if (msg.error) {
          logs = [...logs, { step: `Dump: ${msg.error}`, status: 'error' }];
        } else if (msg.result) {
          logs = [
            ...logs,
            {
              step: `Dump: ${msg.result.meta.nodeCount} узлов (${msg.result.meta.selectionName})`,
              status: 'success',
            },
          ];
        }
        break;

      case 'ERROR':
        logs = [...logs, { step: msg.message, status: 'error' }];
        isParsing = false;
        isDumping = false;
        break;
    }
  });

  sendMessage({ type: 'GET_SELECTION' });
  sendMessage({ type: 'GET_SCHEMAS' });

  // ─── Actions ─────────────────────────────────────────────

  function startParsing(): void {
    logs = [];
    output = null;
    svgConfig = null;
    svgExports = null;
    errors = [];
    isParsing = true;
    activeTab = 'config';
    sendMessage({ type: 'PARSE', schemaId: selectedSchemaId });
  }

  async function copyConfig(): Promise<void> {
    if (!output) return;
    await copyText(output);
    copiedConfig = true;
    setTimeout(() => (copiedConfig = false), 2000);
  }

  async function copySvgConfig(): Promise<void> {
    if (!svgConfig) return;
    await copyText(svgConfig);
    copiedSvg = true;
    setTimeout(() => (copiedSvg = false), 2000);
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  }

  function downloadSvgs(): void {
    if (!svgExports || svgExports.length === 0) return;
    isDownloading = true;
    svgExportDone = 0;
    svgExportTotal = svgExports.length;
    svgExportCurrentName = '';
    svgPackPercent = 0;
    svgPhase = 'exporting';
    sendMessage({ type: 'DOWNLOAD_SVGS', exports: svgExports });
  }

  async function handleSvgData(files: { name: string; data: number[] }[]): Promise<void> {
    if (files.length === 0) {
      logs = [...logs, { step: '⚠ Нет файлов для скачивания', status: 'warning' }];
      isDownloading = false;
      svgPhase = 'idle';
      return;
    }

    svgPhase = 'packing';
    svgPackPercent = 0;

    const zip = new JSZip();
    for (const file of files) {
      zip.file(`${file.name}.svg`, new Uint8Array(file.data));
    }

    const blob = await zip.generateAsync(
      { type: 'blob' },
      (metadata) => {
        svgPackPercent = Math.round(metadata.percent);
      }
    );

    svgPhase = 'done';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'landmarks-svg.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logs = [...logs, { step: `✓ Скачано ${files.length} SVG файлов`, status: 'success' }];

    setTimeout(() => {
      isDownloading = false;
      svgPhase = 'idle';
    }, 1500);
  }

  function closePlugin(): void {
    sendMessage({ type: 'CLOSE' });
  }

  function startStructureDump(): void {
    structureDump = null;
    structureDumpJson = null;
    structureDumpError = null;
    isDumping = true;
    devSectionOpen = true;
    sendMessage({
      type: 'DUMP_STRUCTURE',
      options: {
        maxDepth: dumpUnlimitedDepth ? 0 : dumpMaxDepth,
        includeHidden: dumpIncludeHidden,
        includeBBox: dumpIncludeBBox,
      },
    });
  }

  async function copyStructureDump(): Promise<void> {
    if (!structureDumpJson) return;
    await copyText(structureDumpJson);
    copiedDump = true;
    setTimeout(() => (copiedDump = false), 2000);
  }

  function downloadStructureDump(): void {
    if (!structureDumpJson || !structureDump) return;
    const slug = structureDump.meta.selectionName
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'selection';
    const blob = new Blob([structureDumpJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `figma-dump-${slug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Log auto-scroll ─────────────────────────────────────
  let logListEl: HTMLDivElement;

  afterUpdate(() => {
    if (logListEl) {
      logListEl.scrollTop = logListEl.scrollHeight;
    }
  });

  // ─── Computed ────────────────────────────────────────────

  $: selectedSchema = schemas.find((s) => s.id === selectedSchemaId) ?? null;
  $: canParse = !!selectionData && !!selectedSchemaId && !isParsing;
  $: canDump = !!selectionData && !isDumping;
  $: hasSvg = !!svgConfig && !!svgExports && svgExports.length > 0;

  const statusIcon: Record<string, string> = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: '→',
  };
</script>

<main>
  <!-- Header -->
  <!-- <header>
    <div class="header-title">
      <span class="logo">⬡</span>
      <h1>Figma Parser</h1>
    </div>
    <button class="icon-btn" on:click={closePlugin} title="Закрыть">✕</button>
  </header> -->

  <!-- Selection info -->
  <section class="section">
    <div class="section-label">Выделение</div>
    {#if selectionData}
      <div class="selection-info">
        <span class="node-type">{selectionData.type}</span>
        <span class="node-name">{selectionData.name}</span>
      </div>
    {:else}
      <div class="empty-state">Выделите элемент в Figma</div>
    {/if}
  </section>

  <!-- Schema selector -->
  <section class="section">
    <div class="section-label">Схема парсинга</div>
    {#if schemas.length > 0}
      <div class="schema-picker">
        {#each schemas as schema}
          <button
            class="schema-btn"
            class:active={selectedSchemaId === schema.id}
            on:click={() => (selectedSchemaId = schema.id)}
          >
            {schema.name}
          </button>
        {/each}
      </div>
      {#if selectedSchema}
        <div class="schema-desc">{selectedSchema.description}</div>
      {/if}
    {:else}
      <div class="empty-state">Загрузка схем...</div>
    {/if}
  </section>

  <!-- Action button -->
  <section class="section action-section">
    <button class="btn btn-primary" on:click={startParsing} disabled={!canParse}>
      {#if isParsing}
        <span class="spinner">◌</span> Парсинг...
      {:else}
        Запустить парсинг
      {/if}
    </button>
  </section>

  <!-- Developer: structure dump -->
  <section class="section dev-section">
    <button
      type="button"
      class="dev-toggle"
      on:click={() => (devSectionOpen = !devSectionOpen)}
      aria-expanded={devSectionOpen}
    >
      <span class="dev-toggle-label">Developer</span>
      <span class="dev-toggle-hint">дамп структуры для AI</span>
      <span class="dev-toggle-icon">{devSectionOpen ? '▾' : '▸'}</span>
    </button>

    {#if devSectionOpen}
      <p class="dev-desc">
        Выделите фрейм в Figma и выгрузите дерево узлов (имена, типы, bbox) в JSON — для передачи в чат при разработке новых схем.
      </p>

      <div class="dev-options">
        <label class="dev-option">
          <span>Глубина</span>
          <input
            type="number"
            min="1"
            max="99"
            bind:value={dumpMaxDepth}
            disabled={dumpUnlimitedDepth}
          />
        </label>
        <label class="dev-option dev-option-check">
          <input type="checkbox" bind:checked={dumpUnlimitedDepth} />
          <span>Без лимита</span>
        </label>
        <label class="dev-option dev-option-check">
          <input type="checkbox" bind:checked={dumpIncludeBBox} />
          <span>Bbox</span>
        </label>
        <label class="dev-option dev-option-check">
          <input type="checkbox" bind:checked={dumpIncludeHidden} />
          <span>Скрытые</span>
        </label>
      </div>

      <button class="btn btn-dev" on:click={startStructureDump} disabled={!canDump}>
        {#if isDumping}
          <span class="spinner">◌</span> Дамп...
        {:else}
          Dump structure
        {/if}
      </button>

      {#if structureDumpError}
        <div class="dev-error">{structureDumpError}</div>
      {/if}

      {#if structureDump && structureDumpJson}
        <div class="dev-result">
          <div class="dev-result-meta">
            <span>{structureDump.meta.nodeCount} узлов</span>
            <span>·</span>
            <span>{structureDump.meta.selectionType}</span>
            {#if structureDump.root.childrenTruncated}
              <span>·</span>
              <span class="dev-warn">обрезано по глубине</span>
            {/if}
          </div>
          <div class="btn-row">
            <button class="btn btn-secondary btn-sm" on:click={copyStructureDump}>
              {copiedDump ? '✓ Скопировано' : 'Copy JSON'}
            </button>
            <button class="btn btn-secondary btn-sm" on:click={downloadStructureDump}>
              ↓ Download .json
            </button>
          </div>
          <pre class="result-code dev-dump-code">{structureDumpJson}</pre>
        </div>
      {/if}
    {/if}
  </section>

  <!-- Log output -->
  {#if logs.length > 0}
    <section class="section log-section">
      <div class="section-label">Процесс</div>
      <div class="log-list" bind:this={logListEl}>
        {#each logs as log}
          <div class="log-item log-{log.status}">
            <span class="log-icon">{statusIcon[log.status] ?? '·'}</span>
            <span class="log-text">{log.step}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Errors -->
  {#if errors.length > 0}
    <section class="section error-section">
      <div class="section-label">Проблемы</div>
      {#each errors as error}
        <div class="error-item">{error}</div>
      {/each}
    </section>
  {/if}

  <!-- Result tabs + content -->
  {#if output !== null || svgConfig !== null}
    <section class="section result-section">

      <!-- Tab switcher -->
      <div class="result-tabs">
        <button
          class="tab-btn"
          class:active={activeTab === 'config'}
          on:click={() => (activeTab = 'config')}
        >
          Config
        </button>
        <button
          class="tab-btn"
          class:active={activeTab === 'svg'}
          on:click={() => (activeTab = 'svg')}
          disabled={!hasSvg}
        >
          SVG Config
          {#if hasSvg && svgExports}
            <span class="tab-badge">{svgExports.length}</span>
          {/if}
        </button>
      </div>

      <!-- Config tab -->
      {#if activeTab === 'config'}
        <div class="result-header">
          <div class="section-label">Результат</div>
          <button class="btn btn-secondary btn-sm" on:click={copyConfig} disabled={!output}>
            {copiedConfig ? '✓ Скопировано' : 'Copy Config'}
          </button>
        </div>
        {#if output}
          <pre class="result-code">{output}</pre>
        {:else}
          <div class="empty-state">Нет данных</div>
        {/if}
      {/if}

      <!-- SVG Config tab -->
      {#if activeTab === 'svg'}
        <div class="result-header">
          <div class="section-label">SVG Paths</div>
          <div class="btn-row">
            <button class="btn btn-secondary btn-sm" on:click={copySvgConfig} disabled={!svgConfig}>
              {copiedSvg ? '✓ Скопировано' : 'Copy SVG Config'}
            </button>
            <button
              class="btn btn-secondary btn-sm btn-download"
              on:click={downloadSvgs}
              disabled={!hasSvg || isDownloading}
            >
              ↓ Download SVG
            </button>
          </div>
        </div>
      {#if isDownloading || svgPhase === 'done'}
        <div class="svg-progress">
          <!-- Export phase -->
          <div class="svg-progress-row" class:done={svgPhase !== 'exporting'}>
            <span class="svg-progress-label">Экспорт из Figma</span>
            <span class="svg-progress-count">
              {svgExportDone} / {svgExportTotal}
            </span>
          </div>
          <div class="svg-progress-bar-wrap">
            <div
              class="svg-progress-bar"
              class:bar-done={svgPhase !== 'exporting'}
              style="width: {svgExportTotal > 0 ? Math.round((svgExportDone / svgExportTotal) * 100) : 0}%"
            ></div>
          </div>
          {#if svgPhase === 'exporting' && svgExportCurrentName}
            <div class="svg-progress-name">{svgExportCurrentName}.svg</div>
          {/if}

          <!-- Packing phase -->
          <div class="svg-progress-row" class:done={svgPhase === 'done'} style="margin-top: 8px;">
            <span class="svg-progress-label">Упаковка в архив</span>
            <span class="svg-progress-count">{svgPackPercent}%</span>
          </div>
          <div class="svg-progress-bar-wrap">
            <div
              class="svg-progress-bar"
              class:bar-done={svgPhase === 'done'}
              style="width: {svgPackPercent}%"
            ></div>
          </div>
        </div>
      {/if}

        {#if svgConfig}
          <pre class="result-code">{svgConfig}</pre>
        {/if}
      {/if}

    </section>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { background: #fff; overflow-x: hidden; }

  main {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 12px;
    color: #1e1e1e;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* ── Header ── */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #e8e8e8;
    flex-shrink: 0;
  }
  .header-title { display: flex; align-items: center; gap: 6px; }
  .logo { font-size: 16px; color: #7b61ff; }
  h1 { font-size: 13px; font-weight: 600; }

  /* ── Sections ── */
  .section {
    padding: 10px 14px;
    border-bottom: 1px solid #f0f0f0;
  }
  .section-label {
    font-size: 10px;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 6px;
  }

  /* ── Selection ── */
  .selection-info { display: flex; align-items: center; gap: 8px; }
  .node-type {
    font-size: 10px;
    font-weight: 500;
    color: #7b61ff;
    background: #f0edff;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'SF Mono', monospace;
    flex-shrink: 0;
  }
  .node-name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .empty-state { color: #bbb; font-style: italic; }

  /* ── Schema picker ── */
  .schema-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .schema-btn {
    padding: 5px 10px;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    color: #555;
    transition: all 0.15s;
  }
  .schema-btn:hover { background: #ece9ff; border-color: #c4b5ff; color: #6b4fff; }
  .schema-btn.active { background: #7b61ff; border-color: #7b61ff; color: #fff; }
  .schema-desc {
    font-size: 11px;
    color: #888;
    line-height: 1.4;
  }

  /* ── Action ── */
  .action-section { border-bottom: none; }

  /* ── Developer dump ── */
  .dev-section { background: #faf9ff; }
  .dev-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .dev-toggle-label {
    font-size: 10px;
    font-weight: 600;
    color: #7b61ff;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .dev-toggle-hint {
    flex: 1;
    font-size: 10px;
    color: #aaa;
  }
  .dev-toggle-icon {
    font-size: 10px;
    color: #999;
  }
  .dev-desc {
    margin: 8px 0 10px;
    font-size: 11px;
    color: #777;
    line-height: 1.45;
  }
  .dev-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    margin-bottom: 10px;
  }
  .dev-option {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #555;
  }
  .dev-option input[type='number'] {
    width: 48px;
    padding: 3px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 11px;
  }
  .dev-option input[type='number']:disabled {
    opacity: 0.4;
  }
  .dev-option-check input[type='checkbox'] {
    margin: 0;
  }
  .btn-dev {
    width: 100%;
    padding: 8px 16px;
    background: #f0edff;
    color: #5a45c4;
    border: 1px solid #d4cbff;
    justify-content: center;
  }
  .btn-dev:hover:not(:disabled) { background: #e6e0ff; }
  .dev-error {
    margin-top: 8px;
    padding: 6px 10px;
    background: #fff0f0;
    border: 1px solid #fcc;
    border-radius: 4px;
    color: #c0392b;
    font-size: 11px;
  }
  .dev-result { margin-top: 10px; }
  .dev-result-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 10px;
    color: #888;
    margin-bottom: 8px;
  }
  .dev-warn { color: #b8860b; }
  .dev-dump-code { max-height: 240px; font-size: 10px; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary {
    width: 100%;
    padding: 9px 16px;
    background: #1e1e1e;
    color: #fff;
    justify-content: center;
  }
  .btn-primary:hover:not(:disabled) { background: #333; }
  .btn-secondary {
    background: #f0f0f0;
    color: #333;
    border: 1px solid #e0e0e0;
  }
  .btn-secondary:hover:not(:disabled) { background: #e5e5e5; }
  .btn-download {
    background: #edf5ff;
    color: #1a6fc4;
    border: 1px solid #c3ddf8;
  }
  .btn-download:hover:not(:disabled) { background: #d9ecff; }
  .btn-sm { padding: 4px 10px; font-size: 11px; }
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #bbb;
    font-size: 14px;
    padding: 3px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .icon-btn:hover { color: #555; background: #f0f0f0; }

  /* ── Spinner ── */
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spinner { display: inline-block; animation: spin 1s linear infinite; }

  /* ── Logs ── */
  .log-section { background: #fafafa; }
  .log-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 200px;
    overflow-y: auto;
    scroll-behavior: smooth;
  }
  .log-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 1.4;
  }
  .log-info    { background: #f2f2f2; color: #555; }
  .log-success { background: #edfaed; color: #2a7a2a; }
  .log-error   { background: #fff0f0; color: #c0392b; }
  .log-warning { background: #fffbee; color: #b8860b; }
  .log-icon { font-size: 10px; flex-shrink: 0; margin-top: 1px; }
  .log-text { flex: 1; word-break: break-word; }

  /* ── Errors ── */
  .error-item {
    padding: 6px 10px;
    background: #fff0f0;
    border: 1px solid #fcc;
    border-radius: 4px;
    color: #c0392b;
    font-size: 11px;
    margin-bottom: 4px;
  }

  /* ── Result ── */
  .result-section { flex: 1; }

  .result-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }
  .tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    color: #666;
    transition: all 0.15s;
  }
  .tab-btn:hover:not(:disabled) { background: #ece9ff; border-color: #c4b5ff; color: #6b4fff; }
  .tab-btn.active { background: #7b61ff; border-color: #7b61ff; color: #fff; }
  .tab-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .tab-badge {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 8px;
    line-height: 1.4;
    background: #e0e0e0;
    color: #666;
  }
  .tab-btn.active .tab-badge {
    background: rgba(255, 255, 255, 0.25);
    color: #fff;
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .result-header .section-label { margin-bottom: 0; }

  .btn-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  /* ── SVG Download Progress ── */
  .svg-progress {
    margin-bottom: 10px;
    padding: 10px 12px;
    background: #f5f5f5;
    border: 1px solid #e8e8e8;
    border-radius: 6px;
  }
  .svg-progress-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 5px;
  }
  .svg-progress-label {
    font-size: 11px;
    font-weight: 500;
    color: #555;
  }
  .svg-progress-row.done .svg-progress-label { color: #2a7a2a; }
  .svg-progress-count {
    font-size: 11px;
    font-weight: 600;
    color: #333;
    font-family: 'SF Mono', monospace;
  }
  .svg-progress-name {
    font-size: 10px;
    color: #999;
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .svg-progress-bar-wrap {
    height: 4px;
    background: #e0e0e0;
    border-radius: 2px;
    overflow: hidden;
  }
  .svg-progress-bar {
    height: 100%;
    background: #7b61ff;
    border-radius: 2px;
    transition: width 0.2s ease;
  }
  .svg-progress-bar.bar-done { background: #2a7a2a; }

  .result-code {
    background: #f8f8f8;
    border: 1px solid #ebebeb;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 11px;
    font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
    overflow: auto;
    max-height: 320px;
    color: #2d2d2d;
    white-space: pre;
    word-break: normal;
    tab-size: 2;
  }
</style>
