/// <reference types="@figma/plugin-typings" />

import { nameIncludes, round2, slugify, wrapExport } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';
import { buildSvgConfig, getBBox, getChildNodes, getMapOrigin } from './landmarks-common';

// ─── Output type ───────────────────────────────────────────

interface PathItem {
  code: string;
  svg: string;
  from: string;
  to: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

// ─── Paths frame finder ────────────────────────────────────

function isPathsContainerName(name: string): boolean {
  return nameIncludes(name, 'path');
}

function findPathsFrame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  if (isPathsContainerName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isPathsContainerName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

// ─── Path frame parser ─────────────────────────────────────

function parsePathFrame(
  pathFrame: SceneNode,
  fromCode: string,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): PathItem | null {
  const code = slugify(pathFrame.name.trim());
  const svgName = `${fromCode}_${code}_path`;

  const bbox = getBBox(pathFrame);
  if (!bbox) {
    logs.push({ step: `  ⚠ Нет bbox у "${pathFrame.name.trim()}"`, status: 'warning' });
    return null;
  }

  svgExports.push({ name: svgName, nodeId: pathFrame.id });
  logs.push({ step: `  ✓ → "${code}" (${svgName})`, status: 'success' });

  return {
    code,
    svg: svgName,
    from: fromCode,
    to: code,
    left: round2(bbox.x - originX),
    top: round2(bbox.y - originY),
    width: round2(bbox.width),
    height: round2(bbox.height),
  };
}

// ─── Project group parser ──────────────────────────────────

function parseFromGroup(
  fromGroup: SceneNode,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): PathItem[] {
  const fromCode = slugify(fromGroup.name.trim());
  logs.push({ step: `Проект: "${fromGroup.name.trim()}" → "${fromCode}"`, status: 'info' });

  const items: PathItem[] = [];

  for (const child of getChildNodes(fromGroup)) {
    const item = parsePathFrame(child, fromCode, originX, originY, svgExports, logs);
    if (item) items.push(item);
  }

  if (items.length === 0) {
    logs.push({ step: `  ⚠ Нет путей в "${fromGroup.name.trim()}"`, status: 'warning' });
  }

  return items;
}

// ─── Result builder ────────────────────────────────────────

function buildPathsResult(
  items: PathItem[],
  svgExports: SvgExportItem[],
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const output = wrapExport('paths', items);

  let svgConfig: string | null = null;
  if (svgExports.length > 0) {
    svgConfig = buildSvgConfig(svgExports, 'paths');
    logs.push({ step: `SVG конфиг: ${svgExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });
  return { output, svgConfig, svgExports, svgFolder: 'paths', logs, errors };
}

// ─── Entry point ───────────────────────────────────────────

export function parsePaths(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const pathsFrame = findPathsFrame(selectedNode, logs);
  if (!pathsFrame) {
    errors.push('Группа "Paths" не найдена. Выделите Paths или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in pathsFrame)) {
    errors.push('Paths не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const { originX, originY } = getMapOrigin(pathsFrame, logs);
  const fromGroups = getChildNodes(pathsFrame);
  logs.push({ step: `Групп проектов: ${fromGroups.length}`, status: 'info' });

  const allItems: PathItem[] = [];
  const svgExports: SvgExportItem[] = [];

  for (const group of fromGroups) {
    allItems.push(...parseFromGroup(group, originX, originY, svgExports, logs));
  }

  logs.push({
    step: `Итого: ${allItems.length} путей`,
    status: allItems.length > 0 ? 'success' : 'warning',
  });

  if (allItems.length === 0) {
    errors.push('Ни одного пути не найдено.');
  }

  return buildPathsResult(allItems, svgExports, logs, errors);
}
