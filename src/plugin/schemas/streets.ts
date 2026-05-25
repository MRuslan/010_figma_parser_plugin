/// <reference types="@figma/plugin-typings" />

import { nameIncludes, round2, slugify, wrapExport } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';
import { buildSvgConfig, getBBox, getChildNodes, getMapOrigin } from './landmarks-common';
import { getLanguageFrames } from './landmarks-detect';
import {
  detectStreetsStructure,
  findStreetsViewports,
  type StreetsStructureFlags,
} from './streets-detect';

// ─── Output types ──────────────────────────────────────────

interface StreetBreakpoint {
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
}

interface StreetItem {
  language?: string[];
  svg: string;
  left: number;
  top: number;
  width: number;
  height: number;
  breakpoints: { 768: StreetBreakpoint };
}

// ─── SVG naming ────────────────────────────────────────────

function getStreetSvgName(
  code: string,
  language: string,
  isMobile: boolean,
  hasLanguages: boolean
): string {
  if (!hasLanguages) {
    return isMobile ? `${code}_street_mob` : `${code}_street`;
  }
  return isMobile ? `${code}_street_mob_${language}` : `${code}_street_${language}`;
}

// ─── Streets frame finder ──────────────────────────────────

function isStreetsContainerName(name: string): boolean {
  return (
    nameIncludes(name, 'street') &&
    !nameIncludes(name, 'mobile') &&
    !nameIncludes(name, 'mob') &&
    !nameIncludes(name, 'desktop') &&
    !nameIncludes(name, 'desk')
  );
}

function findStreetsFrame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  if (isStreetsContainerName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isStreetsContainerName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

// ─── Leaf extraction ───────────────────────────────────────

interface StreetLeaf {
  code: string;
  name: string;
  lang: string;
  node: SceneNode;
}

function getStreetLeaves(
  viewport: SceneNode,
  flags: StreetsStructureFlags,
  defaultLang: string
): StreetLeaf[] {
  const leaves: StreetLeaf[] = [];

  if (flags.languages) {
    for (const langFrame of getLanguageFrames(viewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      for (const child of getChildNodes(langFrame)) {
        const name = child.name.trim();
        leaves.push({ code: slugify(name), name, lang, node: child });
      }
    }
  } else {
    for (const child of getChildNodes(viewport)) {
      const name = child.name.trim();
      leaves.push({ code: slugify(name), name, lang: defaultLang, node: child });
    }
  }

  return leaves;
}

// ─── Ordered (code, lang) pair builder ────────────────────

/**
 * Returns unique (code, lang) pairs in output order:
 * for each code (from desktop first), for each language (from desktop's lang groups).
 * Adds any missing codes/languages found only in mobile.
 */
function buildOrderedPairs(
  dLeaves: StreetLeaf[],
  mLeaves: StreetLeaf[],
  viewport: SceneNode | null,
  flags: StreetsStructureFlags
): { code: string; lang: string; name: string }[] {
  // Collect unique codes in order (desktop first, then mobile additions)
  const codesInOrder: string[] = [];
  const codeNames = new Map<string, string>();
  for (const l of [...dLeaves, ...mLeaves]) {
    if (!codeNames.has(l.code)) {
      codesInOrder.push(l.code);
      codeNames.set(l.code, l.name);
    }
  }

  // Collect unique languages in order from the desktop viewport's language groups
  const langsInOrder: string[] = [];
  if (flags.languages && viewport) {
    for (const langFrame of getLanguageFrames(viewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      if (!langsInOrder.includes(lang)) langsInOrder.push(lang);
    }
  }
  // Add any languages from mobile not covered by desktop
  for (const l of mLeaves) {
    if (!langsInOrder.includes(l.lang)) langsInOrder.push(l.lang);
  }
  if (langsInOrder.length === 0) langsInOrder.push('en');

  const pairs: { code: string; lang: string; name: string }[] = [];
  for (const code of codesInOrder) {
    for (const lang of langsInOrder) {
      pairs.push({ code, lang, name: codeNames.get(code)! });
    }
  }

  return pairs;
}

// ─── Result builder ────────────────────────────────────────

function buildStreetsResult(
  items: StreetItem[],
  svgExports: SvgExportItem[],
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const output = wrapExport('streets', items);

  const seen = new Set<string>();
  const uniqueExports = svgExports.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  let svgConfig: string | null = null;
  if (uniqueExports.length > 0) {
    svgConfig = buildSvgConfig(uniqueExports, 'streets');
    logs.push({ step: `SVG конфиг: ${uniqueExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });
  return { output, svgConfig, svgExports: uniqueExports, svgFolder: 'streets', logs, errors };
}

// ─── Entry point ───────────────────────────────────────────

export function parseStreets(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const streetsFrame = findStreetsFrame(selectedNode, logs);
  if (!streetsFrame) {
    errors.push('Группа "Streets" не найдена. Выделите Streets или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in streetsFrame)) {
    errors.push('Streets не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const profile = detectStreetsStructure(streetsFrame);
  logs.push({ step: `Вариант структуры: ${profile.variantLabel}`, status: 'info' });

  if (profile.variant === 'unknown') {
    errors.push('Не удалось определить структуру. Ожидаются Viewports (Mobile / Desktop).');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const { originX, originY } = getMapOrigin(streetsFrame, logs);
  const { mobile, desktop } = findStreetsViewports(streetsFrame);
  const hasLanguages = profile.flags.languages;

  // Collect leaves from each viewport
  const dLeaves = desktop ? getStreetLeaves(desktop, profile.flags, 'en') : [];
  const mLeaves = mobile ? getStreetLeaves(mobile, profile.flags, 'en') : [];

  logs.push({ step: `Desktop: ${dLeaves.length} элементов`, status: 'info' });
  logs.push({ step: `Mobile: ${mLeaves.length} элементов`, status: 'info' });

  // Build lookup maps: key = code + '_' + lang
  const dMap = new Map<string, StreetLeaf>();
  for (const l of dLeaves) dMap.set(`${l.code}_${l.lang}`, l);

  const mMap = new Map<string, StreetLeaf>();
  for (const l of mLeaves) mMap.set(`${l.code}_${l.lang}`, l);

  // Determine ordered (code, lang) pairs
  const primaryViewport = desktop ?? mobile;
  const pairs = buildOrderedPairs(dLeaves, mLeaves, primaryViewport, profile.flags);

  const items: StreetItem[] = [];
  const svgExports: SvgExportItem[] = [];

  for (const { code, lang, name } of pairs) {
    const key = `${code}_${lang}`;
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

    const desktopSvg = getStreetSvgName(code, lang, false, hasLanguages);
    const mobileSvg = getStreetSvgName(code, lang, true, hasLanguages);

    if (dLeaf) svgExports.push({ name: desktopSvg, nodeId: dLeaf.node.id });
    if (mLeaf) svgExports.push({ name: mobileSvg, nodeId: mLeaf.node.id });

    const item: StreetItem = {
      language: hasLanguages ? [lang] : undefined,
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
    logs.push({ step: `  ✓ ${name}${langNote}`, status: 'success' });
    items.push(item);
  }

  logs.push({
    step: `Итого: ${items.length} улиц`,
    status: items.length > 0 ? 'success' : 'warning',
  });

  if (items.length === 0) {
    errors.push('Ни одной улицы не найдено.');
  }

  return buildStreetsResult(items, svgExports, logs, errors);
}
