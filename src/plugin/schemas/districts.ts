/// <reference types="@figma/plugin-typings" />

import { nameIncludes, round2, slugify, getZoomLevel, wrapExport } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';
import { buildSvgConfig, getBBox, getChildNodes, getMapOrigin } from './landmarks-common';
import { getLanguageFrames, getZoomFrames } from './landmarks-detect';
import {
  detectDistrictsStructure,
  findDistrictsViewports,
  type DistrictsStructureFlags,
} from './districts-detect';

// ─── Output types ──────────────────────────────────────────

interface DistrictBreakpoint {
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
}

interface DistrictItem {
  language?: string[];
  zoom?: number;
  svg: string;
  left: number;
  top: number;
  width: number;
  height: number;
  breakpoints: { 768: DistrictBreakpoint };
}

// ─── SVG naming ────────────────────────────────────────────

function getDistrictSvgName(
  code: string,
  language: string,
  zoom: number,
  isMobile: boolean,
  hasLanguages: boolean,
  hasZooms: boolean
): string {
  const mobPart = isMobile ? '_mob' : '';
  const langSuffix = hasLanguages ? `_${language}` : '';
  const zoomSuffix = hasZooms ? `_zoom_${zoom}` : '';
  return `${code}_district${mobPart}${langSuffix}${zoomSuffix}`;
}

// ─── Districts frame finder ────────────────────────────────

function isDistrictsContainerName(name: string): boolean {
  return (
    nameIncludes(name, 'district') &&
    !nameIncludes(name, 'mobile') &&
    !nameIncludes(name, 'mob') &&
    !nameIncludes(name, 'desktop') &&
    !nameIncludes(name, 'desk')
  );
}

function findDistrictsFrame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  if (isDistrictsContainerName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isDistrictsContainerName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

// ─── Leaf extraction ───────────────────────────────────────

interface DistrictLeaf {
  code: string;
  name: string;
  lang: string;
  zoom: number; // 0 when no zoom layers
  node: SceneNode;
}

function getDistrictLeaves(
  viewport: SceneNode,
  flags: DistrictsStructureFlags,
  defaultLang: string
): DistrictLeaf[] {
  const leaves: DistrictLeaf[] = [];

  if (flags.languages && flags.zooms) {
    for (const langFrame of getLanguageFrames(viewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      for (const zoomFrame of getZoomFrames(langFrame)) {
        const zoom = getZoomLevel(zoomFrame.name)!;
        for (const child of getChildNodes(zoomFrame)) {
          const name = child.name.trim();
          leaves.push({ code: slugify(name), name, lang, zoom, node: child });
        }
      }
    }
  } else if (flags.languages) {
    for (const langFrame of getLanguageFrames(viewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      for (const child of getChildNodes(langFrame)) {
        const name = child.name.trim();
        leaves.push({ code: slugify(name), name, lang, zoom: 0, node: child });
      }
    }
  } else if (flags.zooms) {
    for (const zoomFrame of getZoomFrames(viewport)) {
      const zoom = getZoomLevel(zoomFrame.name)!;
      for (const child of getChildNodes(zoomFrame)) {
        const name = child.name.trim();
        leaves.push({ code: slugify(name), name, lang: defaultLang, zoom, node: child });
      }
    }
  } else {
    for (const child of getChildNodes(viewport)) {
      const name = child.name.trim();
      leaves.push({ code: slugify(name), name, lang: defaultLang, zoom: 0, node: child });
    }
  }

  return leaves;
}

// ─── Ordered (code, lang, zoom) triple builder ─────────────

interface DistrictTriple {
  code: string;
  lang: string;
  zoom: number;
  name: string;
}

function buildOrderedTriples(
  dLeaves: DistrictLeaf[],
  mLeaves: DistrictLeaf[],
  primaryViewport: SceneNode | null,
  flags: DistrictsStructureFlags
): DistrictTriple[] {
  // Collect unique codes in order (desktop first, then mobile additions)
  const codesInOrder: string[] = [];
  const codeNames = new Map<string, string>();
  for (const l of [...dLeaves, ...mLeaves]) {
    if (!codeNames.has(l.code)) {
      codesInOrder.push(l.code);
      codeNames.set(l.code, l.name);
    }
  }

  // Collect unique languages in order from the primary viewport's language groups
  const langsInOrder: string[] = [];
  if (flags.languages && primaryViewport) {
    for (const langFrame of getLanguageFrames(primaryViewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      if (!langsInOrder.includes(lang)) langsInOrder.push(lang);
    }
  }
  for (const l of mLeaves) {
    if (!langsInOrder.includes(l.lang)) langsInOrder.push(l.lang);
  }
  if (langsInOrder.length === 0) langsInOrder.push('en');

  // Collect unique zooms in order from desktop (or mobile)
  const zoomsInOrder: number[] = [];
  if (flags.zooms && primaryViewport) {
    // Zoom frames may be under language groups or directly in viewport
    const sampleLangOrViewport =
      flags.languages
        ? (getLanguageFrames(primaryViewport)[0] ?? primaryViewport)
        : primaryViewport;
    for (const zf of getZoomFrames(sampleLangOrViewport)) {
      const z = getZoomLevel(zf.name)!;
      if (!zoomsInOrder.includes(z)) zoomsInOrder.push(z);
    }
  }
  // Add any zooms found only in mobile leaves
  for (const l of mLeaves) {
    if (l.zoom !== 0 && !zoomsInOrder.includes(l.zoom)) zoomsInOrder.push(l.zoom);
  }
  if (zoomsInOrder.length === 0) zoomsInOrder.push(0);

  const triples: DistrictTriple[] = [];
  for (const code of codesInOrder) {
    for (const lang of langsInOrder) {
      for (const zoom of zoomsInOrder) {
        triples.push({ code, lang, zoom, name: codeNames.get(code)! });
      }
    }
  }

  return triples;
}

// ─── Result builder ────────────────────────────────────────

function buildDistrictsResult(
  items: DistrictItem[],
  svgExports: SvgExportItem[],
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const output = wrapExport('districts', items);

  const seen = new Set<string>();
  const uniqueExports = svgExports.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  let svgConfig: string | null = null;
  if (uniqueExports.length > 0) {
    svgConfig = buildSvgConfig(uniqueExports, 'districts');
    logs.push({ step: `SVG конфиг: ${uniqueExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });
  return { output, svgConfig, svgExports: uniqueExports, svgFolder: 'districts', logs, errors };
}

// ─── Entry point ───────────────────────────────────────────

export function parseDistricts(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const districtsFrame = findDistrictsFrame(selectedNode, logs);
  if (!districtsFrame) {
    errors.push('Группа "Districts" не найдена. Выделите Districts или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in districtsFrame)) {
    errors.push('Districts не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const profile = detectDistrictsStructure(districtsFrame);
  logs.push({ step: `Вариант структуры: ${profile.variantLabel}`, status: 'info' });

  if (profile.variant === 'unknown') {
    errors.push('Не удалось определить структуру. Ожидаются Viewports (Mobile / Desktop).');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const { originX, originY } = getMapOrigin(districtsFrame, logs);
  const { mobile, desktop } = findDistrictsViewports(districtsFrame);
  const { languages: hasLanguages, zooms: hasZooms } = profile.flags;

  // Collect leaves from each viewport
  const dLeaves = desktop ? getDistrictLeaves(desktop, profile.flags, 'en') : [];
  const mLeaves = mobile ? getDistrictLeaves(mobile, profile.flags, 'en') : [];

  logs.push({ step: `Desktop: ${dLeaves.length} элементов`, status: 'info' });
  logs.push({ step: `Mobile: ${mLeaves.length} элементов`, status: 'info' });

  // Build lookup maps: key = code|lang|zoom
  const dMap = new Map<string, DistrictLeaf>();
  for (const l of dLeaves) dMap.set(`${l.code}|${l.lang}|${l.zoom}`, l);

  const mMap = new Map<string, DistrictLeaf>();
  for (const l of mLeaves) mMap.set(`${l.code}|${l.lang}|${l.zoom}`, l);

  // Determine ordered (code, lang, zoom) triples
  const primaryViewport = desktop ?? mobile;
  const triples = buildOrderedTriples(dLeaves, mLeaves, primaryViewport, profile.flags);

  const items: DistrictItem[] = [];
  const svgExports: SvgExportItem[] = [];

  for (const { code, lang, zoom, name } of triples) {
    const key = `${code}|${lang}|${zoom}`;
    const dLeaf = dMap.get(key);
    const mLeaf = mMap.get(key);

    if (!dLeaf && !mLeaf) continue;

    const dBBox = dLeaf ? getBBox(dLeaf.node) : null;
    const mBBox = mLeaf ? getBBox(mLeaf.node) : null;

    if (!dBBox && !mBBox) {
      logs.push({ step: `  ⚠ "${name}" [${lang}] — нет bbox`, status: 'warning' });
      continue;
    }

    const mainBBox = dBBox ?? mBBox!;
    const mobBBox = mBBox ?? dBBox!;

    const desktopSvg = getDistrictSvgName(code, lang, zoom, false, hasLanguages, hasZooms);
    const mobileSvg = getDistrictSvgName(code, lang, zoom, true, hasLanguages, hasZooms);

    if (dLeaf) svgExports.push({ name: desktopSvg, nodeId: dLeaf.node.id });
    if (mLeaf) svgExports.push({ name: mobileSvg, nodeId: mLeaf.node.id });

    const item: DistrictItem = {
      language: hasLanguages ? [lang] : undefined,
      zoom: hasZooms ? zoom : undefined,
      svg: desktopSvg,
      left: round2(mainBBox.x - originX),
      top: round2(mainBBox.y - originY),
      width: round2(mainBBox.width),
      height: round2(mainBBox.height),
      breakpoints: {
        768: {
          left: round2(mobBBox.x - originX),
          top: round2(mobBBox.y - originY),
          width: round2(mobBBox.width),
          height: round2(mobBBox.height),
          svg: mobileSvg,
        },
      },
    };

    const langNote = hasLanguages ? ` [${lang}]` : '';
    const zoomNote = hasZooms ? ` zoom:${zoom}` : '';
    logs.push({ step: `  ✓ ${name}${langNote}${zoomNote}`, status: 'success' });
    items.push(item);
  }

  logs.push({
    step: `Итого: ${items.length} районов`,
    status: items.length > 0 ? 'success' : 'warning',
  });

  if (items.length === 0) {
    errors.push('Ни одного района не найдено.');
  }

  return buildDistrictsResult(items, svgExports, logs, errors);
}
