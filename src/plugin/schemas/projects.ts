/// <reference types="@figma/plugin-typings" />

import { getZoomLevel, nameIncludes, round2, slugify, wrapExport } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';
import { buildSvgConfig, getBBox, getChildNodes, getMapOrigin } from './landmarks-common';
import { findDirectAnchor, getLanguageFrames, getZoomFrames } from './landmarks-detect';
import {
  detectProjectsStructure,
  findProjectViewports,
  getProjectGroups,
  isProjectZoneName,
  type ProjectsStructureFlags,
} from './projects-detect';

// ─── Output types ──────────────────────────────────────────

interface ProjectZoneItem {
  type: 'zone';
  code: string;
  state: string;
  clickable: true;
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
}

interface ProjectBody {
  left: number;
  top: number;
  width: number;
  height: number;
  svg: string;
  scale: true;
}

interface ProjectV2Item {
  type: 'v2';
  code: string;
  state: string;
  clickable: true;
  zoom?: number;
  language?: string[];
  anchor: { left: number; top: number; width: number; height: number };
  body: ProjectBody;
  breakpoints: { 768: { body: ProjectBody } };
}

type ProjectOutputItem = ProjectZoneItem | ProjectV2Item;

// ─── Internal: leaf data extracted from a viewport ─────────

interface ViewportLeaf {
  language: string;
  zoom: number;
  labelNode: SceneNode;
  anchorNode: EllipseNode | null;
}

// ─── SVG naming ────────────────────────────────────────────

function getBodySvgName(
  code: string,
  language: string,
  isMobile: boolean,
  hasLanguages: boolean
): string {
  if (!hasLanguages) {
    return isMobile ? `${code}_button_mob` : `${code}_button`;
  }
  return isMobile ? `${code}_button_${language}_mob` : `${code}_button_${language}`;
}

// ─── Node finders ──────────────────────────────────────────

function findZoneFrame(projectGroup: SceneNode): SceneNode | null {
  for (const child of getChildNodes(projectGroup)) {
    if (isProjectZoneName(child.name)) return child;
  }
  return null;
}

function findLabelFrame(container: SceneNode): SceneNode | null {
  for (const child of getChildNodes(container)) {
    if (nameIncludes(child.name, 'label')) return child;
  }
  return null;
}

// ─── Zone parsing ──────────────────────────────────────────

function parseZoneItem(
  projectGroup: SceneNode,
  code: string,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): ProjectZoneItem | null {
  const zoneFrame = findZoneFrame(projectGroup);
  if (!zoneFrame) {
    logs.push({ step: `  ⚠ Zone не найдена для "${code}"`, status: 'warning' });
    return null;
  }

  const bbox = getBBox(zoneFrame);
  if (!bbox) return null;

  const svgName = `${code}_zone`;
  svgExports.push({ name: svgName, nodeId: zoneFrame.id });
  logs.push({ step: `  ✓ Zone → ${svgName}`, status: 'success' });

  return {
    type: 'zone',
    code,
    state: code,
    clickable: true,
    left: round2(bbox.x - originX),
    top: round2(bbox.y - originY),
    width: round2(bbox.width),
    height: round2(bbox.height),
    svg: svgName,
  };
}

// ─── Viewport leaf extraction ──────────────────────────────

function extractLeaf(
  container: SceneNode,
  language: string,
  zoom: number,
  out: ViewportLeaf[]
): void {
  const label = findLabelFrame(container);
  if (!label) return;
  out.push({ language, zoom, labelNode: label, anchorNode: findDirectAnchor(container) });
}

function getViewportLeaves(viewport: SceneNode, flags: ProjectsStructureFlags): ViewportLeaf[] {
  const leaves: ViewportLeaf[] = [];

  if (flags.languages && flags.zooms) {
    for (const langFrame of getLanguageFrames(viewport)) {
      const lang = langFrame.name.trim().toLowerCase();
      for (const zf of getZoomFrames(langFrame)) {
        extractLeaf(zf, lang, getZoomLevel(zf.name)!, leaves);
      }
    }
    return leaves;
  }

  if (flags.languages) {
    for (const langFrame of getLanguageFrames(viewport)) {
      extractLeaf(langFrame, langFrame.name.trim().toLowerCase(), 0, leaves);
    }
    return leaves;
  }

  if (flags.zooms) {
    for (const zf of getZoomFrames(viewport)) {
      extractLeaf(zf, 'en', getZoomLevel(zf.name)!, leaves);
    }
    return leaves;
  }

  extractLeaf(viewport, 'en', 0, leaves);
  return leaves;
}

// ─── Body builder ──────────────────────────────────────────

function buildBody(
  labelNode: SceneNode,
  originX: number,
  originY: number,
  svgName: string
): ProjectBody | null {
  const bbox = getBBox(labelNode);
  if (!bbox) return null;
  return {
    left: round2(bbox.x - originX),
    top: round2(bbox.y - originY),
    width: round2(bbox.width),
    height: round2(bbox.height),
    svg: svgName,
    scale: true,
  };
}

// ─── V2 items for a single project ────────────────────────

function parseV2Items(
  projectGroup: SceneNode,
  code: string,
  flags: ProjectsStructureFlags,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): ProjectV2Item[] {
  const { mobile, desktop } = findProjectViewports(projectGroup);

  const mLeaves = mobile ? getViewportLeaves(mobile, flags) : [];
  const dLeaves = desktop ? getViewportLeaves(desktop, flags) : [];

  const mMap = new Map<string, ViewportLeaf>();
  for (const l of mLeaves) mMap.set(`${l.language}:${l.zoom}`, l);

  const dMap = new Map<string, ViewportLeaf>();
  for (const l of dLeaves) dMap.set(`${l.language}:${l.zoom}`, l);

  const keys = new Set([...mMap.keys(), ...dMap.keys()]);
  const items: ProjectV2Item[] = [];

  for (const key of keys) {
    const mLeaf = mMap.get(key);
    const dLeaf = dMap.get(key);

    const [language, zoomStr] = key.split(':');
    const zoom = parseInt(zoomStr, 10);

    const mobileSvg = getBodySvgName(code, language, true, flags.languages);
    const desktopSvg = getBodySvgName(code, language, false, flags.languages);

    const mBody = mLeaf ? buildBody(mLeaf.labelNode, originX, originY, mobileSvg) : null;
    const dBody = dLeaf ? buildBody(dLeaf.labelNode, originX, originY, desktopSvg) : null;

    if (!mBody && !dBody) {
      logs.push({ step: `  ⚠ "${code}" [${key}] — нет Label`, status: 'warning' });
      continue;
    }

    const anchorNode = dLeaf?.anchorNode ?? mLeaf?.anchorNode ?? null;
    if (!anchorNode) {
      logs.push({ step: `  ⚠ "${code}" [${key}] — нет Anchor`, status: 'warning' });
      continue;
    }

    const aBBox = getBBox(anchorNode as unknown as SceneNode);
    if (!aBBox) continue;

    if (dLeaf) svgExports.push({ name: desktopSvg, nodeId: dLeaf.labelNode.id });
    if (mLeaf) svgExports.push({ name: mobileSvg, nodeId: mLeaf.labelNode.id });

    const finalDesktop = dBody ?? { ...mBody!, svg: desktopSvg };
    const finalMobile = mBody ?? { ...dBody!, svg: mobileSvg };

    const item: ProjectV2Item = {
      type: 'v2',
      code,
      state: code,
      clickable: true,
      zoom: flags.zooms && zoom > 0 ? zoom : undefined,
      language: flags.languages ? [language] : undefined,
      anchor: {
        left: round2(aBBox.x - originX),
        top: round2(aBBox.y - originY),
        width: round2(aBBox.width),
        height: round2(aBBox.height),
      },
      body: finalDesktop,
      breakpoints: { 768: { body: finalMobile } },
    };

    const langNote = flags.languages ? ` [${language}]` : '';
    const zoomNote = flags.zooms && zoom > 0 ? ` zoom:${zoom}` : '';
    logs.push({ step: `  ✓ ${code}${langNote}${zoomNote}`, status: 'success' });

    items.push(item);
  }

  return items;
}

// ─── Single project group parser ───────────────────────────

function parseProjectGroup(
  projectGroup: SceneNode,
  flags: ProjectsStructureFlags,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): ProjectOutputItem[] {
  const code = slugify(projectGroup.name.trim());
  logs.push({ step: `Проект: "${projectGroup.name.trim()}" → "${code}"`, status: 'info' });

  const items: ProjectOutputItem[] = [];
  const zoneItem = parseZoneItem(projectGroup, code, originX, originY, svgExports, logs);
  if (zoneItem) items.push(zoneItem);
  items.push(...parseV2Items(projectGroup, code, flags, originX, originY, svgExports, logs));

  return items;
}

// ─── Projects frame finder ─────────────────────────────────

function isProjectsContainerName(name: string): boolean {
  return (
    nameIncludes(name, 'project') &&
    !nameIncludes(name, 'zone') &&
    !nameIncludes(name, 'mobile') &&
    !nameIncludes(name, 'mob') &&
    !nameIncludes(name, 'desktop') &&
    !nameIncludes(name, 'desk')
  );
}

function findProjectsFrame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  if (isProjectsContainerName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isProjectsContainerName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

// ─── Result builder ────────────────────────────────────────

function buildProjectsResult(
  items: ProjectOutputItem[],
  svgExports: SvgExportItem[],
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  const output = wrapExport('projects', items);

  const seen = new Set<string>();
  const uniqueExports = svgExports.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  let svgConfig: string | null = null;
  if (uniqueExports.length > 0) {
    svgConfig = buildSvgConfig(uniqueExports, 'projects');
    logs.push({ step: `SVG конфиг: ${uniqueExports.length} файлов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });
  return { output, svgConfig, svgExports: uniqueExports, svgFolder: 'projects', logs, errors };
}

// ─── Entry point ───────────────────────────────────────────

export function parseProjects(selectedNode: SceneNode): ParseResult {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const projectsFrame = findProjectsFrame(selectedNode, logs);
  if (!projectsFrame) {
    errors.push('Группа "Projects" не найдена. Выделите Projects или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in projectsFrame)) {
    errors.push('Projects не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const profile = detectProjectsStructure(projectsFrame);
  logs.push({ step: `Вариант структуры: ${profile.variantLabel}`, status: 'info' });

  if (profile.variant === 'unknown') {
    errors.push(
      'Не удалось определить структуру. Ожидаются Viewports (Project_Mobile / Project_Desktop).'
    );
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const { originX, originY } = getMapOrigin(projectsFrame, logs);
  const projectGroups = getProjectGroups(projectsFrame);
  logs.push({ step: `Проектов: ${projectGroups.length}`, status: 'info' });

  const allItems: ProjectOutputItem[] = [];
  const svgExports: SvgExportItem[] = [];

  for (const group of projectGroups) {
    allItems.push(...parseProjectGroup(group, profile.flags, originX, originY, svgExports, logs));
  }

  if (allItems.length === 0) {
    errors.push('Ни одного проекта не найдено.');
  }

  return buildProjectsResult(allItems, svgExports, logs, errors);
}
