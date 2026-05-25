/// <reference types="@figma/plugin-typings" />

import { nameIncludes, round2, slugify, wrapExport } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';
import { buildSvgConfig, getBBox, getChildNodes, getMapOrigin } from './landmarks-common';
import { getLanguageFrames } from './landmarks-detect';
import {
  detectRadiusStructure,
  findRadiusNode,
  findRadiusViewports,
  getRadiusProjectGroups,
  type RadiusStructureFlags,
} from './radius-detect';

// ─── Output types ──────────────────────────────────────────

interface RadiusBreakpoint {
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
}

interface RadiusItem {
  code: string;
  language?: string[];
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
  breakpoints: { 768: RadiusBreakpoint };
}

// ─── SVG naming ────────────────────────────────────────────

function getRadiusSvgName(
  code: string,
  language: string,
  isMobile: boolean,
  hasLanguages: boolean
): string {
  if (!hasLanguages) {
    return isMobile ? `${code}_radius_mob` : `${code}_radius`;
  }
  return isMobile ? `${code}_radius_${language}_mob` : `${code}_radius_${language}`;
}

// ─── Radius frame finder ───────────────────────────────────

function isRadiusContainerName(name: string): boolean {
  return (
    nameIncludes(name, 'radius') &&
    !nameIncludes(name, 'mobile') &&
    !nameIncludes(name, 'mob') &&
    !nameIncludes(name, 'desktop') &&
    !nameIncludes(name, 'desk')
  );
}

function findRadiusFrame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  if (isRadiusContainerName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isRadiusContainerName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

// ─── Leaf extraction ───────────────────────────────────────

interface RadiusLeaf {
  language: string;
  node: SceneNode;
}

function extractLeaves(
  viewport: SceneNode,
  flags: RadiusStructureFlags,
  out: RadiusLeaf[]
): void {
  if (flags.languages) {
    for (const langFrame of getLanguageFrames(viewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      const radiusNode = findRadiusNode(langFrame);
      if (radiusNode) {
        out.push({ language: lang, node: radiusNode });
      }
    }
  } else {
    const radiusNode = findRadiusNode(viewport);
    if (radiusNode) {
      out.push({ language: 'en', node: radiusNode });
    }
  }
}

// ─── Project group parser ──────────────────────────────────

function parseRadiusProject(
  projectGroup: SceneNode,
  flags: RadiusStructureFlags,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): RadiusItem[] {
  const code = slugify(projectGroup.name.trim());
  logs.push({ step: `Проект: "${projectGroup.name.trim()}" → "${code}"`, status: 'info' });

  const { mobile, desktop } = findRadiusViewports(projectGroup);

  const mLeaves: RadiusLeaf[] = [];
  const dLeaves: RadiusLeaf[] = [];

  if (mobile) extractLeaves(mobile, flags, mLeaves);
  if (desktop) extractLeaves(desktop, flags, dLeaves);

  const mMap = new Map<string, RadiusLeaf>();
  for (const l of mLeaves) mMap.set(l.language, l);

  const dMap = new Map<string, RadiusLeaf>();
  for (const l of dLeaves) dMap.set(l.language, l);

  const languages = new Set([...mMap.keys(), ...dMap.keys()]);
  const items: RadiusItem[] = [];

  for (const lang of languages) {
    const mLeaf = mMap.get(lang);
    const dLeaf = dMap.get(lang);

    const desktopSvg = getRadiusSvgName(code, lang, false, flags.languages);
    const mobileSvg = getRadiusSvgName(code, lang, true, flags.languages);

    const dBBox = dLeaf ? getBBox(dLeaf.node) : null;
    const mBBox = mLeaf ? getBBox(mLeaf.node) : null;

    if (!dBBox && !mBBox) {
      logs.push({ step: `  ⚠ "${code}" [${lang}] — нет bbox`, status: 'warning' });
      continue;
    }

    const mainBBox = dBBox ?? mBBox!;
    const mobBBox = mBBox ?? dBBox!;

    if (dLeaf) svgExports.push({ name: desktopSvg, nodeId: dLeaf.node.id });
    if (mLeaf) svgExports.push({ name: mobileSvg, nodeId: mLeaf.node.id });

    const item: RadiusItem = {
      code,
      language: flags.languages ? [lang] : undefined,
      left: round2(mainBBox.x - originX),
      top: round2(mainBBox.y - originY),
      width: round2(mainBBox.width),
      height: round2(mainBBox.height),
      svg: desktopSvg,
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

    const langNote = flags.languages ? ` [${lang}]` : '';
    logs.push({ step: `  ✓ ${code}${langNote}`, status: 'success' });
    items.push(item);
  }

  if (items.length === 0) {
    logs.push({ step: `  ⚠ Нет радиусов в "${projectGroup.name.trim()}"`, status: 'warning' });
  }

  return items;
}

// ─── Result builder ────────────────────────────────────────

function buildRadiusResult(
  items: RadiusItem[],
  svgExports: SvgExportItem[],
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const output = wrapExport('radius', items);

  const seen = new Set<string>();
  const uniqueExports = svgExports.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  let svgConfig: string | null = null;
  if (uniqueExports.length > 0) {
    svgConfig = buildSvgConfig(uniqueExports, 'radius');
    logs.push({ step: `SVG конфиг: ${uniqueExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });
  return { output, svgConfig, svgExports: uniqueExports, svgFolder: 'radius', logs, errors };
}

// ─── Entry point ───────────────────────────────────────────

export function parseRadius(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const radiusFrame = findRadiusFrame(selectedNode, logs);
  if (!radiusFrame) {
    errors.push('Группа "Radius" не найдена. Выделите Radius или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in radiusFrame)) {
    errors.push('Radius не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const profile = detectRadiusStructure(radiusFrame);
  logs.push({ step: `Вариант структуры: ${profile.variantLabel}`, status: 'info' });

  if (profile.variant === 'unknown') {
    errors.push('Не удалось определить структуру. Ожидаются Viewports (Mobile / Desktop).');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const { originX, originY } = getMapOrigin(radiusFrame, logs);
  const projectGroups = getRadiusProjectGroups(radiusFrame);
  logs.push({ step: `Проектов: ${projectGroups.length}`, status: 'info' });

  const allItems: RadiusItem[] = [];
  const svgExports: SvgExportItem[] = [];

  for (const group of projectGroups) {
    allItems.push(
      ...parseRadiusProject(group, profile.flags, originX, originY, svgExports, logs)
    );
  }

  logs.push({
    step: `Итого: ${allItems.length} радиусов`,
    status: allItems.length > 0 ? 'success' : 'warning',
  });

  if (allItems.length === 0) {
    errors.push('Ни одного радиуса не найдено.');
  }

  return buildRadiusResult(allItems, svgExports, logs, errors);
}
