/// <reference types="@figma/plugin-typings" />

import { nameIncludes, wrapExport } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';

// ─── Shared output types ───────────────────────────────────

export interface LandmarkAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LandmarkBubble {
  left?: number;
  top?: number;
  width: number;
  height: number;
  svg: string;
}

export interface LandmarkItem {
  id: string;
  type: 'v2';
  code: string;
  anchor: LandmarkAnchor;
  bubble: LandmarkBubble;
  language: string[];
  /** v2 + Zoom layer: исходный уровень из Figma (zoom_1 → 1). Без Zoom-слоя поле не задаётся. */
  zoom?: number;
  /** v1: вычисляемые границы (в v2 не используются) */
  minZoom?: number;
  maxZoom?: number;
}

export interface LandmarksConfig {
  mobile_landmarks: LandmarkItem[];
  desktop_landmarks: LandmarkItem[];
}

// ─── Node helpers ──────────────────────────────────────────

export function getChildNodes(node: SceneNode): SceneNode[] {
  if (!('children' in node)) return [];
  return [...node.children];
}

export function getBBox(node: SceneNode): Rect | null {
  return node.absoluteBoundingBox ?? null;
}

export function isViewportFrameName(name: string): boolean {
  return (
    nameIncludes(name, 'mobile') ||
    nameIncludes(name, 'mob') ||
    nameIncludes(name, 'desktop') ||
    nameIncludes(name, 'desk')
  );
}

// ─── Landmarks frame discovery ─────────────────────────────

export function findLandmarksFrame(
  selectedNode: SceneNode,
  logs: LogEntry[]
): SceneNode | null {
  if (nameIncludes(selectedNode.name, 'landmark')) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (nameIncludes(child.name, 'landmark')) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

export function getMapOrigin(
  landmarksFrame: SceneNode,
  logs: LogEntry[]
): { originX: number; originY: number } {
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
    logs.push({
      step: 'Родительский фрейм не найден — координаты будут canvas-абсолютными',
      status: 'warning',
    });
  }

  return { originX, originY };
}

export function findViewportFrames(landmarksFrame: SceneNode): {
  mobile: SceneNode | null;
  desktop: SceneNode | null;
} {
  let mobile: SceneNode | null = null;
  let desktop: SceneNode | null = null;

  for (const child of getChildNodes(landmarksFrame)) {
    const n = child.name;
    if (nameIncludes(n, 'mobile') || nameIncludes(n, 'mob')) {
      mobile = child;
    } else if (nameIncludes(n, 'desktop') || nameIncludes(n, 'desk')) {
      desktop = child;
    }
  }

  return { mobile, desktop };
}

// ─── Result builder ────────────────────────────────────────

export function buildLandmarksResult(
  mobileLandmarks: LandmarkItem[],
  desktopLandmarks: LandmarkItem[],
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const config: LandmarksConfig = {
    mobile_landmarks: mobileLandmarks,
    desktop_landmarks: desktopLandmarks,
  };

  const output = wrapExport('map_landmarks', config);

  const svgMap = new Map<string, string>();
  for (const item of [...mobileLandmarks, ...desktopLandmarks]) {
    if (!svgMap.has(item.bubble.svg)) {
      svgMap.set(item.bubble.svg, item.id);
    }
  }

  const svgExports: SvgExportItem[] = Array.from(svgMap.entries()).map(
    ([name, nodeId]) => ({ name, nodeId })
  );

  let svgConfig: string | null = null;
  if (svgExports.length > 0) {
    const entries = svgExports
      .map(({ name }) => `\t"${name}": "./svg/map/[name_map]/landmarks/${name}"`)
      .join(',\n');
    svgConfig = `export default {\n${entries},\n};\n`;
    logs.push({ step: `SVG конфиг: ${svgExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });

  return { output, svgConfig, svgExports, logs, errors };
}
