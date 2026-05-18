/// <reference types="@figma/plugin-typings" />

import { getSvgName, getZoomLevel, isLanguageCode, round2, slugify } from '../utils';
import type { LogEntry, ParseResult } from '../types';
import {
  buildLandmarksResult,
  findLandmarksFrame,
  findViewportFrames,
  getBBox,
  getChildNodes,
  getMapOrigin,
  type LandmarkItem,
} from './landmarks-common';
import {
  detectV2Structure,
  findDirectAnchor,
  findLabelFrame,
  getLanguageFrames,
  getZoomFrames,
  isLandmarkContainerCandidate,
  type LandmarksStructureFlags,
  type LandmarksV2Variant,
} from './landmarks-detect';

// ─── Single landmark (Label + optional Anchor) ─────────────

function parseLandmarkItemV2(
  container: SceneNode,
  originX: number,
  originY: number,
  isMobile: boolean,
  language: string,
  zoomLevel = 0
): LandmarkItem | null {
  const code = slugify(container.name.trim());
  const svg = getSvgName(code, language, isMobile);
  const label = findLabelFrame(container);

  if (!label) return null;

  const labelBBox = getBBox(label);
  if (!labelBBox) return null;

  const bubbleLeft = round2(labelBBox.x - originX);
  const bubbleTop = round2(labelBBox.y - originY);
  const bubbleW = round2(labelBBox.width);
  const bubbleH = round2(labelBBox.height);

  const anchorNode = findDirectAnchor(container);

  if (anchorNode) {
    const anchorBBox = getBBox(anchorNode as unknown as SceneNode);
    if (!anchorBBox) return null;

    const item: LandmarkItem = {
      id: label.id,
      type: 'v2',
      code,
      anchor: {
        left: round2(anchorBBox.x - originX),
        top: round2(anchorBBox.y - originY),
        width: round2(anchorBBox.width),
        height: round2(anchorBBox.height),
      },
      bubble: {
        left: bubbleLeft,
        top: bubbleTop,
        width: bubbleW,
        height: bubbleH,
        svg,
      },
      language: [language],
    };
    if (zoomLevel > 0) item.zoom = zoomLevel;
    return item;
  }

  const item: LandmarkItem = {
    id: label.id,
    type: 'v2',
    code,
    anchor: {
      left: bubbleLeft,
      top: bubbleTop,
      width: bubbleW,
      height: bubbleH,
    },
    bubble: {
      width: bubbleW,
      height: bubbleH,
      svg,
    },
    language: [language],
  };
  if (zoomLevel > 0) item.zoom = zoomLevel;
  return item;
}

function parseLandmarksInContainer(
  containerParent: SceneNode,
  originX: number,
  originY: number,
  isMobile: boolean,
  language: string,
  zoomLevel: number,
  logs: LogEntry[]
): LandmarkItem[] {
  const items: LandmarkItem[] = [];

  for (const child of getChildNodes(containerParent)) {
    if (!isLandmarkContainerCandidate(child)) {
      logs.push({
        step: `  ⚠ Пропущен слой: "${child.name.trim()}"`,
        status: 'warning',
      });
      continue;
    }

    const item = parseLandmarkItemV2(child, originX, originY, isMobile, language, zoomLevel);
    if (item) {
      items.push(item);
      const anchorNote = findDirectAnchor(child) ? '' : ' (label-only)';
      const zoomNote = item.zoom ? `, zoom: ${item.zoom}` : '';
      logs.push({
        step: `  ✓ ${child.name.trim()} → "${item.code}"${anchorNote}${zoomNote}`,
        status: 'success',
      });
    } else {
      logs.push({
        step: `  ⚠ Пропущен: "${child.name.trim()}" — нет Label`,
        status: 'warning',
      });
    }
  }

  return items;
}

function warnUnexpectedSiblings(
  parent: SceneNode,
  expected: 'language' | 'zoom' | 'landmark',
  logs: LogEntry[]
): void {
  for (const child of getChildNodes(parent)) {
    if (expected === 'language' && isLanguageCode(child.name)) continue;
    if (expected === 'zoom' && getZoomLevel(child.name) !== null) continue;
    if (expected === 'landmark' && isLandmarkContainerCandidate(child)) continue;
    if (getZoomLevel(child.name) !== null) continue;
    if (isLanguageCode(child.name)) continue;

    logs.push({
      step: `  ⚠ Неожиданный дочерний элемент: "${child.name.trim()}"`,
      status: 'warning',
    });
  }
}

function parseZoomLayers(
  zoomParent: SceneNode,
  originX: number,
  originY: number,
  isMobile: boolean,
  language: string,
  logs: LogEntry[]
): LandmarkItem[] {
  const zoomFrames = getZoomFrames(zoomParent);
  if (zoomFrames.length === 0) return [];

  const allItems: LandmarkItem[] = [];

  for (const zoomFrame of zoomFrames) {
    const level = getZoomLevel(zoomFrame.name)!;
    const langTag = language !== 'en' ? `, lang: ${language}` : '';
    logs.push({ step: `  Zoom ${level}${langTag}`, status: 'info' });

    allItems.push(
      ...parseLandmarksInContainer(
        zoomFrame,
        originX,
        originY,
        isMobile,
        language,
        level,
        logs
      )
    );
  }

  warnUnexpectedSiblings(zoomParent, 'zoom', logs);
  return allItems;
}

function parseViewportV2(
  viewportFrame: SceneNode,
  flags: LandmarksStructureFlags,
  originX: number,
  originY: number,
  isMobile: boolean,
  logs: LogEntry[]
): LandmarkItem[] {
  if (flags.languages && flags.zooms) {
    const langFrames = getLanguageFrames(viewportFrame);
    logs.push({
      step: `  Языковые слои: ${langFrames.map((f) => `"${f.name.trim()}"`).join(', ')}`,
      status: 'info',
    });

    const allItems: LandmarkItem[] = [];
    for (const langFrame of langFrames) {
      const language = langFrame.name.trim().toLowerCase();
      logs.push({ step: `  Язык: ${language}`, status: 'info' });
      allItems.push(
        ...parseZoomLayers(langFrame, originX, originY, isMobile, language, logs)
      );
    }
    warnUnexpectedSiblings(viewportFrame, 'language', logs);
    return allItems;
  }

  if (flags.languages) {
    const langFrames = getLanguageFrames(viewportFrame);
    logs.push({
      step: `  Языковые слои: ${langFrames.map((f) => `"${f.name.trim()}"`).join(', ')}`,
      status: 'info',
    });

    const allItems: LandmarkItem[] = [];
    for (const langFrame of langFrames) {
      const language = langFrame.name.trim().toLowerCase();
      logs.push({ step: `  Язык: ${language}`, status: 'info' });
      allItems.push(
        ...parseLandmarksInContainer(langFrame, originX, originY, isMobile, language, 0, logs)
      );
    }
    warnUnexpectedSiblings(viewportFrame, 'language', logs);
    return allItems;
  }

  if (flags.zooms) {
    logs.push({ step: '  Языковых слоёв нет, используется "en"', status: 'info' });
    return parseZoomLayers(viewportFrame, originX, originY, isMobile, 'en', logs);
  }

  logs.push({ step: '  Языковых слоёв нет, используется "en"', status: 'info' });
  return parseLandmarksInContainer(viewportFrame, originX, originY, isMobile, 'en', 0, logs);
}

// ─── Main parse (all v2 variants) ──────────────────────────

function parseV2Core(
  landmarksFrame: SceneNode,
  flags: LandmarksStructureFlags,
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const { originX, originY } = getMapOrigin(landmarksFrame, logs);
  const { mobile, desktop } = findViewportFrames(landmarksFrame);

  if (!mobile) {
    errors.push('Не найден фрейм Mobile (ищем по ключевому слову "mobile"/"mob").');
  }
  if (!desktop) {
    errors.push('Не найден фрейм Desktop (ищем по ключевому слову "desktop"/"desk").');
  }
  if (!mobile && !desktop) {
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const mobileLandmarks: LandmarkItem[] = [];
  if (mobile) {
    logs.push({ step: `Парсинг Mobile: "${mobile.name.trim()}"`, status: 'info' });
    const items = parseViewportV2(mobile, flags, originX, originY, true, logs);
    mobileLandmarks.push(...items);
    logs.push({
      step: `Mobile: итого ${items.length} лендмарков`,
      status: items.length > 0 ? 'success' : 'warning',
    });
  }

  const desktopLandmarks: LandmarkItem[] = [];
  if (desktop) {
    logs.push({ step: `Парсинг Desktop: "${desktop.name.trim()}"`, status: 'info' });
    const items = parseViewportV2(desktop, flags, originX, originY, false, logs);
    desktopLandmarks.push(...items);
    logs.push({
      step: `Desktop: итого ${items.length} лендмарков`,
      status: items.length > 0 ? 'success' : 'warning',
    });
  }

  return buildLandmarksResult(mobileLandmarks, desktopLandmarks, logs, errors);
}

function parseV2ByVariant(
  landmarksFrame: SceneNode,
  variant: LandmarksV2Variant,
  flags: LandmarksStructureFlags,
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  switch (variant) {
    case 'viewports':
    case 'viewports+languages':
    case 'viewports+zooms':
    case 'viewports+languages+zooms':
      return parseV2Core(landmarksFrame, flags, logs, errors);

    default:
      errors.push(
        'Не удалось определить структуру v2. Ожидаются Viewports (Mobile/Desktop) или известная комбинация слоёв.'
      );
      return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }
}

export function parseLandmarksV2(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const landmarksFrame = findLandmarksFrame(selectedNode, logs);
  if (!landmarksFrame) {
    errors.push('Группа "Landmarks" не найдена. Выделите сам Landmarks или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in landmarksFrame)) {
    errors.push('Landmarks не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const profile = detectV2Structure(landmarksFrame);
  logs.push({ step: `Вариант v2: ${profile.variantLabel}`, status: 'info' });

  return parseV2ByVariant(landmarksFrame, profile.variant, profile.flags, logs, errors);
}
