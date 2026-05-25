/// <reference types="@figma/plugin-typings" />

import type { MessageToPlugin, MessageToUI, FigmaNodeInfo } from './types';
import { getSchema, getSchemasInfo } from './schemas/index';
import { dumpStructure } from './dev-dump';

// ─── Plugin window ───────────────────────────────────────────
figma.showUI(__html__, {
  width: 420,
  height: 640,
  title: 'Figma Parser',
});

// ─── Helpers ─────────────────────────────────────────────────

function sendToUI(msg: MessageToUI): void {
  figma.ui.postMessage(msg);
}

function getNodeInfo(node: SceneNode, depth = 0): FigmaNodeInfo {
  const info: FigmaNodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if ('children' in node && depth < 3) {
    info.children = node.children.map((child) => getNodeInfo(child, depth + 1));
  }
  return info;
}

function getCurrentSelection(): FigmaNodeInfo | null {
  const sel = figma.currentPage.selection;
  if (sel.length === 0) return null;
  return getNodeInfo(sel[0]);
}

// ─── Selection listener ──────────────────────────────────────

figma.on('selectionchange', () => {
  sendToUI({ type: 'SELECTION_DATA', data: getCurrentSelection() });
});

// ─── Message handler (UI → Plugin) ───────────────────────────

figma.ui.on('message', (msg: MessageToPlugin) => {
  switch (msg.type) {

    case 'GET_SELECTION': {
      sendToUI({ type: 'SELECTION_DATA', data: getCurrentSelection() });
      break;
    }

    case 'GET_SCHEMAS': {
      sendToUI({ type: 'SCHEMAS_LIST', schemas: getSchemasInfo() });
      break;
    }

    case 'PARSE': {
      const selection = figma.currentPage.selection;

      if (selection.length === 0) {
        sendToUI({ type: 'ERROR', message: 'Нет выделенного элемента.' });
        return;
      }

      const schema = getSchema(msg.schemaId);
      if (!schema) {
        sendToUI({ type: 'ERROR', message: `Схема "${msg.schemaId}" не найдена.` });
        return;
      }

      sendToUI({ type: 'PARSE_PROGRESS', step: `Схема: "${schema.name}"`, status: 'info' });
      sendToUI({ type: 'PARSE_PROGRESS', step: 'Начало парсинга...', status: 'info' });

      let result;
      try {
        result = schema.parse(selection[0]);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendToUI({ type: 'PARSE_PROGRESS', step: `Критическая ошибка: ${message}`, status: 'error' });
        sendToUI({ type: 'PARSE_RESULT', output: null, svgConfig: null, svgExports: null, errors: [message] });
        return;
      }

      // Relay all log entries as progress messages
      for (const log of result.logs) {
        sendToUI({ type: 'PARSE_PROGRESS', step: log.step, status: log.status });
      }

      sendToUI({
        type: 'PARSE_RESULT',
        output: result.output,
        svgConfig: result.svgConfig,
        svgExports: result.svgExports,
        svgFolder: result.svgFolder,
        errors: result.errors,
      });
      break;
    }

    case 'DOWNLOAD_SVGS': {
      const exportsSnapshot = msg.exports; // capture before async
      (async () => {
        const files: { name: string; data: number[] }[] = [];
        const total = exportsSnapshot.length;
        let done = 0;

        sendToUI({ type: 'PARSE_PROGRESS', step: `SVG экспорт: ${total} файлов`, status: 'info' });

        for (const exp of exportsSnapshot) {
          try {
            const node = await figma.getNodeByIdAsync(exp.nodeId);

            if (!node) {
              sendToUI({ type: 'PARSE_PROGRESS', step: `⚠ Нода не найдена: "${exp.name}" (id: ${exp.nodeId})`, status: 'warning' });
            } else if (!('exportAsync' in node)) {
              sendToUI({ type: 'PARSE_PROGRESS', step: `⚠ Нода не поддерживает экспорт: "${exp.name}" (тип: ${node.type})`, status: 'warning' });
            } else {
              const bytes = await (node as ExportMixin).exportAsync({ format: 'SVG' });
              files.push({ name: exp.name, data: Array.from(bytes) });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendToUI({ type: 'PARSE_PROGRESS', step: `  ✗ ${exp.name}: ${errMsg}`, status: 'error' });
          }

          done++;
          sendToUI({ type: 'SVG_EXPORT_PROGRESS', done, total, currentName: exp.name });
        }

        sendToUI({ type: 'SVG_DATA', files });
      })().catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        sendToUI({ type: 'PARSE_PROGRESS', step: `✗ Критическая ошибка экспорта: ${errMsg}`, status: 'error' });
        sendToUI({ type: 'SVG_DATA', files: [] });
      });
      break;
    }

    case 'DUMP_STRUCTURE': {
      const selection = figma.currentPage.selection;

      if (selection.length === 0) {
        sendToUI({
          type: 'STRUCTURE_DUMP_RESULT',
          result: null,
          error: 'Нет выделенного элемента.',
        });
        return;
      }

      try {
        const result = dumpStructure(selection[0], msg.options);
        sendToUI({ type: 'STRUCTURE_DUMP_RESULT', result, error: null });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendToUI({ type: 'STRUCTURE_DUMP_RESULT', result: null, error: message });
      }
      break;
    }

    case 'CLOSE': {
      figma.closePlugin();
      break;
    }
  }
});

// ─── Init ────────────────────────────────────────────────────

sendToUI({ type: 'SELECTION_DATA', data: getCurrentSelection() });
sendToUI({ type: 'SCHEMAS_LIST', schemas: getSchemasInfo() });
