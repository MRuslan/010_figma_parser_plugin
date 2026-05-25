/// <reference types="@figma/plugin-typings" />

import {
  slugify,
  nameIncludes,
  round2,
  wrapExport,
  isLanguageCode,
  getSvgName,
  getZoomLevel,
  isSameLandmark,
} from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';

// ─── Output types ──────────────────────────────────────────

interface LandmarkAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LandmarkBubble {
  left?: number;
  top?: number;
  width: number;
  height: number;
  svg: string;
}

interface LandmarkItem {
  id: string;
  type: 'v2';
  code: string;
  anchor: LandmarkAnchor;
  bubble: LandmarkBubble;
  language: string[];
  minZoom?: number;
  maxZoom?: number;
}

interface LandmarksConfig {
  mobile_landmarks: LandmarkItem[];
  desktop_landmarks: LandmarkItem[];
}

// ─── Internal types ────────────────────────────────────────

/** A raw landmark item before zoom logic is applied. */
interface RawLandmarkItem extends LandmarkItem {
  _zoomLevel: number; // 0 = no zoom context
}

/** A group of raw items at a specific zoom level. */
interface ZoomGroup {
  level: number;
  items: RawLandmarkItem[];
}

// ─── Frame inspection helpers ──────────────────────────────

function getBBox(node: SceneNode): Rect | null {
  return node.absoluteBoundingBox ?? null;
}

function findAnchorEllipse(lineFrame: SceneNode): EllipseNode | null {
  if (!('children' in lineFrame)) return null;
  for (const child of lineFrame.children) {
    if (child.type === 'ELLIPSE') return child as EllipseNode;
  }
  return null;
}

function findLineFrame(layoutFrame: SceneNode): FrameNode | null {
  if (!('children' in layoutFrame)) return null;
  for (const child of layoutFrame.children) {
    if (nameIncludes(child.name, 'line') && child.type === 'FRAME') {
      return child as FrameNode;
    }
  }
  return null;
}

function findBubbleInstance(layoutFrame: SceneNode): InstanceNode | null {
  if (!('children' in layoutFrame)) return null;
  for (const child of layoutFrame.children) {
    if (child.type === 'INSTANCE') return child as InstanceNode;
  }
  return null;
}

// ─── Single landmark parser ────────────────────────────────

/**
 * Parse one landmark container frame into a RawLandmarkItem.
 * @param container  Frame named after landmark (e.g. "Yas Waterworld")
 * @param originX    Map frame canvas X
 * @param originY    Map frame canvas Y
 * @param isMobile   Mobile vs Desktop viewport
 * @param language   Language code ("en", "ar", …)
 * @param zoomLevel  0 = no zoom, N = zoom level N
 */
function parseLandmarkItem(
  container: SceneNode,
  originX: number,
  originY: number,
  isMobile: boolean,
  language: string,
  zoomLevel: number
): RawLandmarkItem | null {
  const landmarkName = container.name.trim();
  const code = slugify(landmarkName);
  const svg = getSvgName(code, language, isMobile);

  if (!('children' in container) || container.children.length === 0) return null;

  // First child = layout frame ("Left Bottom", "Center Top", "Center", etc.)
  const layoutFrame = container.children[0];

  const bubbleInstance = findBubbleInstance(layoutFrame);
  if (!bubbleInstance) return null;

  const bubbleBBox = getBBox(bubbleInstance);
  if (!bubbleBBox) return null;

  const bubbleLeft = round2(bubbleBBox.x - originX);
  const bubbleTop  = round2(bubbleBBox.y - originY);
  const bubbleW    = round2(bubbleBBox.width);
  const bubbleH    = round2(bubbleBBox.height);

  // Try to find anchor ellipse inside Line frame
  const lineFrame = findLineFrame(layoutFrame);
  const anchorEllipse = lineFrame ? findAnchorEllipse(lineFrame) : null;

  if (anchorEllipse) {
    // Separate anchor dot + bubble image
    const anchorBBox = getBBox(anchorEllipse as unknown as SceneNode);
    if (!anchorBBox) return null;

    return {
      id: bubbleInstance.id,
      type: 'v2',
      code,
      anchor: {
        left: round2(anchorBBox.x - originX),
        top:  round2(anchorBBox.y - originY),
        width:  round2(anchorBBox.width),
        height: round2(anchorBBox.height),
      },
      bubble: {
        left: bubbleLeft,
        top:  bubbleTop,
        width:  bubbleW,
        height: bubbleH,
        svg,
      },
      language: [language],
      _zoomLevel: zoomLevel,
    };
  } else {
    // No separate anchor — bubble IS the anchor (placed directly on the map)
    return {
      id: bubbleInstance.id,
      type: 'v2',
      code,
      anchor: {
        left: bubbleLeft,
        top:  bubbleTop,
        width:  bubbleW,
        height: bubbleH,
      },
      bubble: {
        width:  bubbleW,
        height: bubbleH,
        svg,
      },
      language: [language],
      _zoomLevel: zoomLevel,
    };
  }
}

// ─── Zoom logic ────────────────────────────────────────────

/**
 * Given zoom groups sorted by level, apply minZoom / maxZoom rules:
 *
 * - Level 1: no minZoom. Gets maxZoom: N.99 if NOT found in level N+1.
 * - Level N (N > 1): minZoom: N. Gets maxZoom: N.99 if NOT found in level N+1.
 * - Last level: minZoom: N, no maxZoom.
 *
 * Landmark identity across levels is checked with fuzzy slug matching.
 */
function applyZoomLogic(zoomGroups: ZoomGroup[], logs: LogEntry[]): LandmarkItem[] {
  if (zoomGroups.length === 0) return [];

  // Sort groups by zoom level ascending
  const sorted = [...zoomGroups].sort((a, b) => a.level - b.level);
  const result: LandmarkItem[] = [];

  for (let gi = 0; gi < sorted.length; gi++) {
    const group = sorted[gi];
    const nextGroup = sorted[gi + 1] ?? null;

    for (const raw of group.items) {
      const { _zoomLevel, ...item } = raw;

      // minZoom: only for levels > 1
      if (group.level > 1) {
        (item as LandmarkItem).minZoom = group.level;
      }

      // maxZoom: if next zoom level exists AND this item is NOT in it
      if (nextGroup) {
        const existsInNext = nextGroup.items.some((next) =>
          isSameLandmark(raw.code, next.code)
        );
        if (!existsInNext) {
          (item as LandmarkItem).maxZoom = parseFloat(`${group.level}.99`);
          logs.push({
            step: `  ↳ "${raw.code}" maxZoom: ${group.level}.99 (нет в Zoom ${nextGroup.level})`,
            status: 'info',
          });
        }
      }

      result.push(item as LandmarkItem);
    }
  }

  return result;
}

// ─── Group frame parsers ───────────────────────────────────

/**
 * Parse landmark items from a frame that may contain:
 * - zoom sub-frames ("Zoom 1", "Zoom_2", …), OR
 * - landmark containers directly.
 */
function parseWithinLanguage(
  frame: SceneNode,
  originX: number,
  originY: number,
  isMobile: boolean,
  language: string,
  logs: LogEntry[],
  errors: string[]
): LandmarkItem[] {
  if (!('children' in frame)) return [];

  // Detect whether there are zoom sub-frames
  const zoomChildren = frame.children.filter(
    (c) => getZoomLevel(c.name) !== null
  );
  const nonZoomChildren = frame.children.filter(
    (c) => getZoomLevel(c.name) === null
  );

  if (zoomChildren.length > 0) {
    // ── Zoom mode ─────────────────────────────────────────
    const zoomGroups: ZoomGroup[] = [];

    for (const zoomFrame of zoomChildren) {
      const level = getZoomLevel(zoomFrame.name)!;
      logs.push({ step: `  Zoom ${level} (lang: ${language})`, status: 'info' });

      if (!('children' in zoomFrame)) continue;
      const items: RawLandmarkItem[] = [];

      for (const container of zoomFrame.children) {
        const item = parseLandmarkItem(container, originX, originY, isMobile, language, level);
        if (item) {
          items.push(item);
          logs.push({ step: `    ✓ ${container.name.trim()} → "${item.code}"`, status: 'success' });
        } else {
          logs.push({
            step: `    ⚠ Пропущен: "${container.name.trim()}" — структура не распознана`,
            status: 'warning',
          });
        }
      }

      zoomGroups.push({ level, items });
    }

    // Warn about non-zoom siblings (unexpected)
    for (const c of nonZoomChildren) {
      logs.push({
        step: `  ⚠ Неожиданный дочерний элемент вне зума: "${c.name.trim()}"`,
        status: 'warning',
      });
    }

    return applyZoomLogic(zoomGroups, logs);

  } else {
    // ── Direct landmarks (no zoom layers) ─────────────────
    const items: LandmarkItem[] = [];
    for (const container of frame.children) {
      const raw = parseLandmarkItem(container, originX, originY, isMobile, language, 0);
      if (raw) {
        const { _zoomLevel, ...item } = raw;
        items.push(item as LandmarkItem);
        logs.push({ step: `  ✓ ${container.name.trim()} → "${raw.code}"`, status: 'success' });
      } else {
        logs.push({
          step: `  ⚠ Пропущен: "${container.name.trim()}" — структура не распознана`,
          status: 'warning',
        });
      }
    }
    return items;
  }
}

/**
 * Parse all landmark items from a viewport frame (Mobile or Desktop).
 * Handles optional language layers and optional zoom layers.
 */
function parseViewport(
  viewportFrame: SceneNode,
  originX: number,
  originY: number,
  isMobile: boolean,
  logs: LogEntry[],
  errors: string[]
): LandmarkItem[] {
  if (!('children' in viewportFrame)) return [];

  const children = viewportFrame.children;

  // Detect language frames (2-3 char ISO codes like "en", "ar")
  const langFrames = children.filter((c) => isLanguageCode(c.name));
  const nonLangFrames = children.filter((c) => !isLanguageCode(c.name));

  if (langFrames.length > 0) {
    // ── Language layers present ────────────────────────────
    logs.push({ step: `  Языковые слои: ${langFrames.map((f) => `"${f.name.trim()}"`).join(', ')}`, status: 'info' });

    const allItems: LandmarkItem[] = [];

    for (const langFrame of langFrames) {
      const language = langFrame.name.trim().toLowerCase();
      logs.push({ step: `  Язык: ${language}`, status: 'info' });
      const items = parseWithinLanguage(langFrame, originX, originY, isMobile, language, logs, errors);
      allItems.push(...items);
    }

    // Warn about non-language siblings
    for (const c of nonLangFrames) {
      if (getZoomLevel(c.name) === null) {
        logs.push({ step: `  ⚠ Элемент вне языкового слоя: "${c.name.trim()}"`, status: 'warning' });
      }
    }

    return allItems;

  } else {
    // ── No language layers — treat as default "en" ─────────
    logs.push({ step: `  Языковых слоёв нет, используется "en"`, status: 'info' });
    return parseWithinLanguage(viewportFrame, originX, originY, isMobile, 'en', logs, errors);
  }
}

// ─── Main export ───────────────────────────────────────────

/**
 * Entry point for the Landmarks schema.
 * Accepts either the "Landmarks" group itself, or a parent frame containing it.
 *
 * Viewport frames are found by keyword ("mobile"/"mob" and "desktop"/"desk")
 * and support both space-separated ("Landmarks Mobile") and
 * underscore-separated ("Landmarks_Desktop") naming.
 */
export function parseLandmarks(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  // ── 1. Find the Landmarks frame ───────────────────────────
  let landmarksFrame: SceneNode | null = null;

  if (nameIncludes(selectedNode.name, 'landmark')) {
    landmarksFrame = selectedNode;
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
  } else if ('children' in selectedNode) {
    for (const child of (selectedNode as FrameNode).children) {
      if (nameIncludes(child.name, 'landmark')) {
        landmarksFrame = child;
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        break;
      }
    }
  }

  if (!landmarksFrame) {
    errors.push('Группа "Landmarks" не найдена. Выделите сам Landmarks или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  // ── 2. Get map origin (parent frame for coordinate offset) ─
  const parent = landmarksFrame.parent;
  let originX = 0;
  let originY = 0;

  if (parent && parent.type !== 'PAGE' && 'absoluteBoundingBox' in parent) {
    const pb = (parent as FrameNode).absoluteBoundingBox;
    if (pb) {
      originX = pb.x;
      originY = pb.y;
      logs.push({
        step: `Карта: "${(parent as FrameNode).name.trim()}" (origin: ${Math.round(originX)}, ${Math.round(originY)})`,
        status: 'info',
      });
    }
  } else {
    logs.push({ step: 'Родительский фрейм не найден — координаты будут canvas-абсолютными', status: 'warning' });
  }

  // ── 3. Find Mobile and Desktop viewport frames ─────────────
  if (!('children' in landmarksFrame)) {
    errors.push('Landmarks фрейм не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  let mobileFrame: SceneNode | null = null;
  let desktopFrame: SceneNode | null = null;

  for (const child of (landmarksFrame as FrameNode).children) {
    const n = child.name;
    if (nameIncludes(n, 'mobile') || nameIncludes(n, 'mob')) {
      mobileFrame = child;
    } else if (nameIncludes(n, 'desktop') || nameIncludes(n, 'desk')) {
      desktopFrame = child;
    }
  }

  if (!mobileFrame) errors.push('Не найден фрейм Mobile (ищем по ключевому слову "mobile"/"mob").');
  if (!desktopFrame) errors.push('Не найден фрейм Desktop (ищем по ключевому слову "desktop"/"desk").');
  if (!mobileFrame && !desktopFrame) return { output: null, svgConfig: null, svgExports: null, logs, errors };

  // ── 4. Parse Mobile ────────────────────────────────────────
  const mobileLandmarks: LandmarkItem[] = [];
  if (mobileFrame) {
    logs.push({ step: `Парсинг Mobile: "${mobileFrame.name.trim()}"`, status: 'info' });
    const items = parseViewport(mobileFrame, originX, originY, true, logs, errors);
    mobileLandmarks.push(...items);
    logs.push({ step: `Mobile: итого ${items.length} лендмарков`, status: items.length > 0 ? 'success' : 'warning' });
  }

  // ── 5. Parse Desktop ───────────────────────────────────────
  const desktopLandmarks: LandmarkItem[] = [];
  if (desktopFrame) {
    logs.push({ step: `Парсинг Desktop: "${desktopFrame.name.trim()}"`, status: 'info' });
    const items = parseViewport(desktopFrame, originX, originY, false, logs, errors);
    desktopLandmarks.push(...items);
    logs.push({ step: `Desktop: итого ${items.length} лендмарков`, status: items.length > 0 ? 'success' : 'warning' });
  }

  // ── 6. Build output ────────────────────────────────────────
  const config: LandmarksConfig = {
    mobile_landmarks: mobileLandmarks,
    desktop_landmarks: desktopLandmarks,
  };

  const output = wrapExport('map_landmarks', config);

  // ── 7. Collect unique SVG exports (deduplicate by svg name) ─
  const svgMap = new Map<string, string>(); // svgName → nodeId
  for (const item of [...mobileLandmarks, ...desktopLandmarks]) {
    if (!svgMap.has(item.bubble.svg)) {
      svgMap.set(item.bubble.svg, item.id);
    }
  }

  const svgExports: SvgExportItem[] = Array.from(svgMap.entries()).map(
    ([name, nodeId]) => ({ name, nodeId })
  );

  // ── 8. Build SVG paths config ──────────────────────────────
  let svgConfig: string | null = null;
  if (svgExports.length > 0) {
    const entries = svgExports
      .map(({ name }) => `\t"${name}": "./svg/map/[name_map]/landmarks/${name}.svg"`)
      .join(',\n');
    svgConfig = `export default {\n${entries},\n};\n`;
    logs.push({ step: `SVG конфиг: ${svgExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });

  return { output, svgConfig, svgExports, svgFolder: 'landmarks', logs, errors };
}
