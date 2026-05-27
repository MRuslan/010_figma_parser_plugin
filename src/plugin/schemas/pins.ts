/// <reference types="@figma/plugin-typings" />

import { nameIncludes, round2, slugify, getZoomLevel, wrapExport, toJSObject } from '../utils';
import type { LogEntry, ParseResult, SvgExportItem } from '../types';
import { buildSvgConfig, getBBox, getChildNodes, getMapOrigin } from './landmarks-common';
import { getLanguageFrames, getZoomFrames } from './landmarks-detect';
import {
  detectPinsStructure,
  findPinsViewports,
  type PinsStructureFlags,
} from './pins-detect';

// ─── Output types ──────────────────────────────────────────

interface PinBreakpoint {
  left: number;
  top: number;
  isRight: boolean;
}

interface PinItem {
  language?: string[];
  /** Lower bound of zoom range (inclusive). Omitted for level 1 → visible from start. */
  minZoom?: number;
  /** Upper bound of zoom range as `N.99`. Omitted for last level → visible till end. */
  maxZoom?: number;
  left: number;
  top: number;
  isRight: boolean;
  text: string;
  breakpoints: { 768: PinBreakpoint };
}

interface PinGroupBreakpoint {
  svg: string;
  iconWidth: number;
  iconHeight: number;
  textColor?: string;
  textBgColor?: string;
}

interface PinGroup {
  svg: string;
  iconWidth: number;
  iconHeight: number;
  textColor?: string;
  textBgColor?: string;
  breakpoints: { 768: PinGroupBreakpoint };
  pins: PinItem[];
}

// ─── Color extraction ──────────────────────────────────────

/** Convert a [0..1] RGB(A) Figma color to hex string. */
function rgb01ToHex(r: number, g: number, b: number, opacity = 1): string {
  const toByte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const hex = `#${toByte(r)}${toByte(g)}${toByte(b)}`;
  if (opacity < 1) return hex + toByte(opacity);
  return hex;
}

/**
 * Returns the hex color of the first visible SOLID fill on the node.
 * Returns null if no SOLID fill, mixed fills, or node doesn't support fills.
 */
function getSolidFillHex(node: SceneNode): string | null {
  if (!('fills' in node)) return null;
  const fills = (node as { fills: ReadonlyArray<Paint> | typeof figma.mixed }).fills;
  if (fills === figma.mixed) return null;
  if (!Array.isArray(fills)) return null;
  for (const fill of fills) {
    if (fill.visible === false) continue;
    if (fill.type !== 'SOLID') continue;
    return rgb01ToHex(fill.color.r, fill.color.g, fill.color.b, fill.opacity ?? 1);
  }
  return null;
}

// ─── Pins container finder ─────────────────────────────────

function isPinsContainerName(name: string): boolean {
  return (
    nameIncludes(name, 'pin') &&
    !nameIncludes(name, 'mobile') &&
    !nameIncludes(name, 'mob') &&
    !nameIncludes(name, 'desktop') &&
    !nameIncludes(name, 'desk')
  );
}

function findPinsFrame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  if (isPinsContainerName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }

  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isPinsContainerName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }

  return null;
}

// ─── Pin internals (Icon + Name) ───────────────────────────

interface PinInternals {
  icon: SceneNode;
  name: SceneNode;
  textNode: TextNode;
  textRaw: string;
}

/** True if a node is visible AND has no hidden ancestor up to (but excluding) the root. */
function isVisible(node: SceneNode): boolean {
  return node.visible !== false;
}

/** Recursively find the first VISIBLE TEXT node inside a frame. */
function findTextNode(node: SceneNode): TextNode | null {
  if (!isVisible(node)) return null;
  if (node.type === 'TEXT') return node as TextNode;
  if (!('children' in node)) return null;
  for (const child of getChildNodes(node)) {
    const found = findTextNode(child);
    if (found) return found;
  }
  return null;
}

/**
 * Extracts Icon and Name children from a pin frame.
 * Icon: visible child FRAME/GROUP/INSTANCE/COMPONENT whose name contains "icon".
 * Name: any other visible FRAME/GROUP/INSTANCE/COMPONENT child (Name L / Name R / Hover / ...).
 * Hidden children (visible:false) are skipped — designers toggle Name L/Name R visibility
 * to choose label side, so we must only use the visible one.
 */
function getPinInternals(pinFrame: SceneNode): PinInternals | null {
  if (!('children' in pinFrame)) return null;

  let icon: SceneNode | null = null;
  let name: SceneNode | null = null;

  for (const child of getChildNodes(pinFrame)) {
    if (!isVisible(child)) continue;
    if (
      child.type !== 'FRAME' &&
      child.type !== 'GROUP' &&
      child.type !== 'INSTANCE' &&
      child.type !== 'COMPONENT'
    ) continue;
    if (nameIncludes(child.name, 'icon')) {
      if (!icon) icon = child;
    } else if (!name) {
      name = child;
    }
  }

  if (!icon || !name) return null;

  const textNode = findTextNode(name);
  if (!textNode) return null;
  const textRaw = textNode.characters;
  if (!textRaw.trim()) return null;

  return { icon, name, textNode, textRaw };
}

// ─── Pin frame & group discovery ───────────────────────────

/**
 * Identifies a pin frame by STRUCTURE (not by name):
 * has a visible "icon" child + at least one other visible content child (label/hover).
 * Works for "Pins ", "Pin", or any other name a designer might use.
 */
function isPinFrameCandidate(node: SceneNode): boolean {
  if (!('children' in node)) return false;
  let hasIcon = false;
  let hasOther = false;
  for (const child of getChildNodes(node)) {
    if (!isVisible(child)) continue;
    if (
      child.type !== 'FRAME' &&
      child.type !== 'GROUP' &&
      child.type !== 'INSTANCE' &&
      child.type !== 'COMPONENT'
    ) continue;
    if (nameIncludes(child.name, 'icon')) hasIcon = true;
    else hasOther = true;
    if (hasIcon && hasOther) return true;
  }
  return false;
}

/**
 * Extracts the category name from an Icon INSTANCE's main component.
 * Examples:
 *   "Type=Education"                  → "Education"
 *   "Type=Education, Style=Filled"    → "Education"
 *   "Education"                        → "Education" (fallback when no Type= prefix)
 * Returns null if mainComponent missing or name empty.
 * Async because plugin runs with documentAccess: dynamic-page.
 */
async function getCategoryFromIcon(iconNode: SceneNode): Promise<string | null> {
  if (iconNode.type !== 'INSTANCE' && iconNode.type !== 'COMPONENT') return null;
  try {
    const main =
      iconNode.type === 'INSTANCE'
        ? await (iconNode as InstanceNode).getMainComponentAsync()
        : (iconNode as ComponentNode);
    if (!main) return null;
    const name = main.name.trim();
    if (!name) return null;
    // Try variant-property format first: "Type=Education[, Other=Foo]"
    const match = name.match(/(?:^|,\s*)Type\s*=\s*([^,]+)/i);
    if (match) return match[1].trim();
    return name;
  } catch {
    return null;
  }
}

// ─── Leaf extraction ───────────────────────────────────────

interface PinLeaf {
  groupCode: string;       // slugified group name with "map_" prefix, e.g. "map_education"
  groupNameRaw: string;
  lang: string;
  zoom: number;            // 0 when no zoom layer
  textRaw: string;
  text: string;            // slugified
  isRight: boolean;
  iconNode: SceneNode;
  iconBBox: Rect;
  textColor: string | null;     // TEXT node fill (#rrggbb[aa])
  textBgColor: string | null;   // Name FRAME fill (#rrggbb[aa])
}

/**
 * Builds a PinLeaf from a pin frame.
 * @param groupOverride if provided (parent layer is a named group), use as group name;
 *                      otherwise extract from Icon component's `Type=` property
 */
async function buildPinLeaf(
  pinFrame: SceneNode,
  groupOverride: string | null,
  lang: string,
  zoom: number,
  logs: LogEntry[]
): Promise<PinLeaf | null> {
  const internals = getPinInternals(pinFrame);
  if (!internals) {
    logs.push({
      step: `  ⚠ Пин "${pinFrame.name.trim()}": нет Icon/Name или пустой текст`,
      status: 'warning',
    });
    return null;
  }

  const iconBBox = getBBox(internals.icon);
  const nameBBox = getBBox(internals.name);
  if (!iconBBox || !nameBBox) {
    logs.push({
      step: `  ⚠ Пин "${pinFrame.name.trim()}": нет bbox у Icon/Name`,
      status: 'warning',
    });
    return null;
  }

  // Determine group: parent layer name (preferred) → Icon component "Type=X" fallback
  let groupNameRaw: string;
  if (groupOverride) {
    groupNameRaw = groupOverride;
  } else {
    const cat = await getCategoryFromIcon(internals.icon);
    if (!cat) {
      logs.push({
        step: `  ⚠ Пин "${pinFrame.name.trim()}": не удалось определить категорию (нет слоя-группы и Type= в Icon component)`,
        status: 'warning',
      });
      return null;
    }
    groupNameRaw = cat;
  }
  const groupCode = `map_${slugify(groupNameRaw)}`;

  const iconCenterX = iconBBox.x + iconBBox.width / 2;
  const nameCenterX = nameBBox.x + nameBBox.width / 2;
  const isRight = nameCenterX > iconCenterX;

  return {
    groupCode,
    groupNameRaw,
    lang,
    zoom,
    textRaw: internals.textRaw,
    text: slugify(internals.textRaw),
    isRight,
    iconNode: internals.icon,
    iconBBox,
    textColor: getSolidFillHex(internals.textNode),
    textBgColor: getSolidFillHex(internals.name),
  };
}

/**
 * Collects pin leaves from a container (viewport / lang-group / zoom-group).
 * Handles both structures:
 *   container → Pin (direct, no group layer)        → group from Icon's `Type=`
 *   container → GroupLayer → Pin (with group layer) → group from layer name
 */
async function collectPinsFromContainer(
  container: SceneNode,
  lang: string,
  zoom: number,
  logs: LogEntry[]
): Promise<PinLeaf[]> {
  const leaves: PinLeaf[] = [];
  for (const child of getChildNodes(container)) {
    if (!isVisible(child)) continue;

    if (isPinFrameCandidate(child)) {
      // Direct pin under container — derive category from Icon component
      const leaf = await buildPinLeaf(child, null, lang, zoom, logs);
      if (leaf) leaves.push(leaf);
      continue;
    }

    // Treat child as a group layer (e.g., "Education")
    if (!('children' in child)) continue;
    const groupName = child.name.trim();
    for (const grand of getChildNodes(child)) {
      if (!isVisible(grand)) continue;
      if (isPinFrameCandidate(grand)) {
        const leaf = await buildPinLeaf(grand, groupName, lang, zoom, logs);
        if (leaf) leaves.push(leaf);
      }
    }
  }
  return leaves;
}

async function getPinLeaves(
  viewport: SceneNode,
  flags: PinsStructureFlags,
  defaultLang: string,
  logs: LogEntry[]
): Promise<PinLeaf[]> {
  const leaves: PinLeaf[] = [];

  if (flags.languages && flags.zooms) {
    for (const langFrame of getLanguageFrames(viewport)) {
      if (!isVisible(langFrame)) continue;
      const lang = langFrame.name.trim().toLowerCase();
      for (const zoomFrame of getZoomFrames(langFrame)) {
        if (!isVisible(zoomFrame)) continue;
        const zoom = getZoomLevel(zoomFrame.name)!;
        leaves.push(...(await collectPinsFromContainer(zoomFrame, lang, zoom, logs)));
      }
    }
  } else if (flags.languages) {
    for (const langFrame of getLanguageFrames(viewport)) {
      if (!isVisible(langFrame)) continue;
      const lang = langFrame.name.trim().toLowerCase();
      leaves.push(...(await collectPinsFromContainer(langFrame, lang, 0, logs)));
    }
  } else if (flags.zooms) {
    for (const zoomFrame of getZoomFrames(viewport)) {
      if (!isVisible(zoomFrame)) continue;
      const zoom = getZoomLevel(zoomFrame.name)!;
      leaves.push(...(await collectPinsFromContainer(zoomFrame, defaultLang, zoom, logs)));
    }
  } else {
    leaves.push(...(await collectPinsFromContainer(viewport, defaultLang, 0, logs)));
  }

  return leaves;
}

// ─── SVG naming ────────────────────────────────────────────

function getPinSvgName(groupCode: string, isMobile: boolean): string {
  // groupCode is already prefixed with "map_" → "map_pin_education[_mob]"
  const base = groupCode.replace(/^map_/, 'map_pin_');
  return isMobile ? `${base}_mob` : base;
}

// ─── Group assembly ────────────────────────────────────────

interface GroupCollector {
  /** First desktop leaf (used for icon size + svg export node) */
  firstDesktopLeaf: PinLeaf | null;
  /** First mobile leaf (used for icon size + svg export node) */
  firstMobileLeaf: PinLeaf | null;
  /** Map key: text|lang|zoom → desktop / mobile leaves */
  dMap: Map<string, PinLeaf>;
  mMap: Map<string, PinLeaf>;
  /** Ordered triples (text, lang, zoom) — first-seen wins, desktop first */
  textsInOrder: string[];
  langsInOrder: string[];
  zoomsInOrder: number[];
  textRaws: Map<string, string>;
}

function makeCollector(): GroupCollector {
  return {
    firstDesktopLeaf: null,
    firstMobileLeaf: null,
    dMap: new Map(),
    mMap: new Map(),
    textsInOrder: [],
    langsInOrder: [],
    zoomsInOrder: [],
    textRaws: new Map(),
  };
}

function pushIfNew<T>(arr: T[], value: T): void {
  if (!arr.includes(value)) arr.push(value);
}

function collectLeaf(
  collector: GroupCollector,
  leaf: PinLeaf,
  fromDesktop: boolean
): void {
  const key = `${leaf.text}|${leaf.lang}|${leaf.zoom}`;
  if (fromDesktop) {
    if (!collector.firstDesktopLeaf) collector.firstDesktopLeaf = leaf;
    if (!collector.dMap.has(key)) collector.dMap.set(key, leaf);
  } else {
    if (!collector.firstMobileLeaf) collector.firstMobileLeaf = leaf;
    if (!collector.mMap.has(key)) collector.mMap.set(key, leaf);
  }
  pushIfNew(collector.textsInOrder, leaf.text);
  pushIfNew(collector.langsInOrder, leaf.lang);
  pushIfNew(collector.zoomsInOrder, leaf.zoom);
  if (!collector.textRaws.has(leaf.text)) collector.textRaws.set(leaf.text, leaf.textRaw);
}

function buildGroup(
  groupCode: string,
  groupNameRaw: string,
  collector: GroupCollector,
  flags: PinsStructureFlags,
  originX: number,
  originY: number,
  svgExports: SvgExportItem[],
  logs: LogEntry[]
): PinGroup | null {
  const primary = collector.firstDesktopLeaf ?? collector.firstMobileLeaf;
  if (!primary) {
    logs.push({ step: `  ⚠ "${groupNameRaw}" — нет пинов`, status: 'warning' });
    return null;
  }

  const desktopSvg = getPinSvgName(groupCode, false);
  const mobileSvg = getPinSvgName(groupCode, true);

  // Icon sizes — desktop from first desktop leaf (fallback to mobile), mobile from first mobile leaf (fallback to desktop)
  const dIcon = collector.firstDesktopLeaf?.iconBBox ?? collector.firstMobileLeaf!.iconBBox;
  const mIcon = collector.firstMobileLeaf?.iconBBox ?? collector.firstDesktopLeaf!.iconBBox;

  // SVG export — desktop node from first desktop leaf, mobile node from first mobile leaf
  if (collector.firstDesktopLeaf) {
    svgExports.push({ name: desktopSvg, nodeId: collector.firstDesktopLeaf.iconNode.id });
  } else if (collector.firstMobileLeaf) {
    // No desktop — still export the desktop-named SVG from mobile node to keep config consistent
    svgExports.push({ name: desktopSvg, nodeId: collector.firstMobileLeaf.iconNode.id });
  }
  if (collector.firstMobileLeaf) {
    svgExports.push({ name: mobileSvg, nodeId: collector.firstMobileLeaf.iconNode.id });
  } else if (collector.firstDesktopLeaf) {
    svgExports.push({ name: mobileSvg, nodeId: collector.firstDesktopLeaf.iconNode.id });
  }

  // Build pins[]: ordered by text → lang → zoom
  // Zoom levels sorted ascending — needed for minZoom/maxZoom (landmarks v1 logic)
  const sortedZooms = [...collector.zoomsInOrder].sort((a, b) => a - b);

  const pins: PinItem[] = [];
  for (const text of collector.textsInOrder) {
    for (const lang of collector.langsInOrder) {
      for (let zi = 0; zi < sortedZooms.length; zi++) {
        const zoom = sortedZooms[zi];
        const nextZoom = sortedZooms[zi + 1];
        const key = `${text}|${lang}|${zoom}`;
        const dLeaf = collector.dMap.get(key);
        const mLeaf = collector.mMap.get(key);
        if (!dLeaf && !mLeaf) continue;

        const primaryLeaf = dLeaf ?? mLeaf!;
        const mobileLeaf = mLeaf ?? dLeaf!;

        const dCenterX = primaryLeaf.iconBBox.x + primaryLeaf.iconBBox.width / 2;
        const dCenterY = primaryLeaf.iconBBox.y + primaryLeaf.iconBBox.height / 2;
        const mCenterX = mobileLeaf.iconBBox.x + mobileLeaf.iconBBox.width / 2;
        const mCenterY = mobileLeaf.iconBBox.y + mobileLeaf.iconBBox.height / 2;

        // ── minZoom / maxZoom (landmarks v1 logic) ──
        // Only emitted when zoom layers exist in Figma.
        // - minZoom: only for levels > 1 (level 1 = visible from the start)
        // - maxZoom: only when next zoom level exists AND this (text, lang) is NOT in it
        //            → "N.99" (visible up to just before next level)
        //            last level OR exists in next → no maxZoom (continues)
        let minZoom: number | undefined;
        let maxZoom: number | undefined;
        if (flags.zooms) {
          if (zoom > 1) {
            minZoom = zoom;
          }
          if (nextZoom !== undefined) {
            const nextKey = `${text}|${lang}|${nextZoom}`;
            const existsInNext =
              collector.dMap.has(nextKey) || collector.mMap.has(nextKey);
            if (!existsInNext) {
              maxZoom = parseFloat(`${zoom}.99`);
            }
          }
        }

        const item: PinItem = {
          language: flags.languages ? [lang] : undefined,
          minZoom,
          maxZoom,
          left: round2(dCenterX - originX),
          top: round2(dCenterY - originY),
          isRight: primaryLeaf.isRight,
          text,
          breakpoints: {
            768: {
              left: round2(mCenterX - originX),
              top: round2(mCenterY - originY),
              isRight: mobileLeaf.isRight,
            },
          },
        };

        const langNote = flags.languages ? ` [${lang}]` : '';
        const zoomNote = flags.zooms ? ` zoom:${zoom}` : '';
        const rangeNote =
          flags.zooms && (minZoom !== undefined || maxZoom !== undefined)
            ? ` (${minZoom ?? '-'}..${maxZoom ?? '-'})`
            : '';
        const rawName = collector.textRaws.get(text) ?? text;
        logs.push({
          step: `  ✓ ${groupNameRaw} → "${rawName.replace(/\s+/g, ' ').trim()}"${langNote}${zoomNote}${rangeNote}`,
          status: 'success',
        });
        pins.push(item);
      }
    }
  }

  if (pins.length === 0) return null;

  // Colors — from first desktop leaf (or mobile fallback) for base,
  // from first mobile leaf (or desktop fallback) for breakpoint
  const baseLeaf = collector.firstDesktopLeaf ?? collector.firstMobileLeaf!;
  const mobLeaf = collector.firstMobileLeaf ?? collector.firstDesktopLeaf!;

  return {
    svg: desktopSvg,
    iconWidth: round2(dIcon.width),
    iconHeight: round2(dIcon.height),
    textColor: baseLeaf.textColor ?? undefined,
    textBgColor: baseLeaf.textBgColor ?? undefined,
    breakpoints: {
      768: {
        svg: mobileSvg,
        iconWidth: round2(mIcon.width),
        iconHeight: round2(mIcon.height),
        textColor: mobLeaf.textColor ?? undefined,
        textBgColor: mobLeaf.textBgColor ?? undefined,
      },
    },
    pins,
  };
}

// ─── i18n collector ────────────────────────────────────────

/**
 * Cleans label text for i18n output:
 * - Normalizes line endings (\r\n / \r → \n)
 * - Replaces newlines with <br> HTML tag
 * - Collapses multiple spaces (incl. non-breaking) into a single space
 * - Trims
 */
function cleanI18nText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>')
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

interface I18nCollector {
  /** slug → ordered Map<lang, cleaned text> */
  data: Map<string, Map<string, string>>;
  /** insertion order of slugs */
  slugOrder: string[];
}

function makeI18nCollector(): I18nCollector {
  return { data: new Map(), slugOrder: [] };
}

function collectI18n(collector: I18nCollector, leaves: PinLeaf[]): void {
  for (const leaf of leaves) {
    if (!leaf.text) continue;
    let langMap = collector.data.get(leaf.text);
    if (!langMap) {
      langMap = new Map();
      collector.data.set(leaf.text, langMap);
      collector.slugOrder.push(leaf.text);
    }
    if (!langMap.has(leaf.lang)) {
      langMap.set(leaf.lang, cleanI18nText(leaf.textRaw));
    }
  }
}

function buildI18nConfigString(collector: I18nCollector): string | null {
  if (collector.slugOrder.length === 0) return null;

  const obj: Record<string, Record<string, string>> = {};
  for (const slug of collector.slugOrder) {
    const langMap = collector.data.get(slug)!;
    const inner: Record<string, string> = {};
    for (const [lang, text] of langMap) {
      inner[lang] = text;
    }
    obj[slug] = inner;
  }

  // Bare object literal (no `export default ... ;` wrapper) — for direct pasting into project config
  return `${toJSObject(obj, 1)}\n`;
}

// ─── Result builder ────────────────────────────────────────

function buildPinsResult(
  groups: Record<string, PinGroup>,
  groupOrder: string[],
  svgExports: SvgExportItem[],
  i18nConfig: string | null,
  logs: LogEntry[],
  errors: string[]
): ParseResult {
  // Re-order groups in groupOrder to keep output deterministic
  const orderedGroups: Record<string, PinGroup> = {};
  for (const code of groupOrder) {
    if (groups[code]) orderedGroups[code] = groups[code];
  }

  const output = wrapExport('map_pins', orderedGroups);

  const seen = new Set<string>();
  const uniqueExports = svgExports.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  let svgConfig: string | null = null;
  if (uniqueExports.length > 0) {
    svgConfig = buildSvgConfig(uniqueExports, 'pins');
    logs.push({ step: `SVG конфиг: ${uniqueExports.length} файлов`, status: 'info' });
  }

  if (i18nConfig) {
    const count = (i18nConfig.match(/^\t[a-z0-9_]+:/gm) ?? []).length;
    logs.push({ step: `Переводы: ${count} уникальных текстов`, status: 'info' });
  }

  logs.push({ step: 'Парсинг завершён ✓', status: 'success' });
  return {
    output,
    svgConfig,
    svgExports: uniqueExports,
    svgFolder: 'pins',
    i18nConfig,
    logs,
    errors,
  };
}

// ─── Entry point ───────────────────────────────────────────

export async function parsePins(selectedNode: SceneNode): Promise<ParseResult> {
  const logs: LogEntry[] = [];
  const errors: string[] = [];

  const pinsFrame = findPinsFrame(selectedNode, logs);
  if (!pinsFrame) {
    errors.push('Группа "Pins" не найдена. Выделите Pins или родительский фрейм.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  if (!('children' in pinsFrame)) {
    errors.push('Pins не содержит дочерних элементов.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const profile = detectPinsStructure(pinsFrame);
  logs.push({ step: `Вариант структуры: ${profile.variantLabel}`, status: 'info' });

  if (profile.variant === 'unknown') {
    errors.push('Не удалось определить структуру. Ожидаются Viewports (Mobile / Desktop).');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  const { originX, originY } = getMapOrigin(pinsFrame, logs);
  const { mobile, desktop } = findPinsViewports(pinsFrame);
  const flags = profile.flags;

  // Collect all leaves from both viewports
  const dLeaves = desktop ? await getPinLeaves(desktop, flags, 'en', logs) : [];
  const mLeaves = mobile ? await getPinLeaves(mobile, flags, 'en', logs) : [];

  logs.push({ step: `Desktop: ${dLeaves.length} пинов`, status: 'info' });
  logs.push({ step: `Mobile: ${mLeaves.length} пинов`, status: 'info' });

  // Build i18n config — desktop first for stable slug ordering
  const i18n = makeI18nCollector();
  collectI18n(i18n, dLeaves);
  collectI18n(i18n, mLeaves);
  const i18nConfig = buildI18nConfigString(i18n);

  // Group leaves by groupCode (desktop first for stable ordering)
  const collectors = new Map<string, GroupCollector>();
  const groupOrder: string[] = [];
  const groupRawNames = new Map<string, string>();

  for (const leaf of dLeaves) {
    if (!collectors.has(leaf.groupCode)) {
      collectors.set(leaf.groupCode, makeCollector());
      groupOrder.push(leaf.groupCode);
      groupRawNames.set(leaf.groupCode, leaf.groupNameRaw);
    }
    collectLeaf(collectors.get(leaf.groupCode)!, leaf, true);
  }
  for (const leaf of mLeaves) {
    if (!collectors.has(leaf.groupCode)) {
      collectors.set(leaf.groupCode, makeCollector());
      groupOrder.push(leaf.groupCode);
      groupRawNames.set(leaf.groupCode, leaf.groupNameRaw);
    }
    collectLeaf(collectors.get(leaf.groupCode)!, leaf, false);
  }

  if (collectors.size === 0) {
    errors.push('Ни одной группы пинов не найдено.');
    return { output: null, svgConfig: null, svgExports: null, logs, errors };
  }

  // Build groups
  const groups: Record<string, PinGroup> = {};
  const svgExports: SvgExportItem[] = [];
  let totalPins = 0;

  for (const code of groupOrder) {
    const collector = collectors.get(code)!;
    const rawName = groupRawNames.get(code)!;
    const group = buildGroup(code, rawName, collector, flags, originX, originY, svgExports, logs);
    if (group) {
      groups[code] = group;
      totalPins += group.pins.length;
      logs.push({
        step: `Группа "${rawName}" → ${code}: ${group.pins.length} пинов`,
        status: 'info',
      });
    }
  }

  logs.push({
    step: `Итого: ${Object.keys(groups).length} групп, ${totalPins} пинов`,
    status: totalPins > 0 ? 'success' : 'warning',
  });

  if (totalPins === 0) {
    errors.push('Ни одного пина не найдено.');
  }

  return buildPinsResult(groups, groupOrder, svgExports, i18nConfig, logs, errors);
}
