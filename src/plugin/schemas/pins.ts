/// <reference types="@figma/plugin-typings" />

import { nameIncludes, round2, slugify, getZoomLevel, isLanguageCode, wrapExport, toJSObject } from '../utils';
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

// ─── V2 structure: composite key "viewport|lang|zoom" ──────

interface CompositeKey {
  viewport: 'mobile' | 'desktop' | null;
  lang: string | null;
  zoom: number | null;
}

/**
 * Parses a composite group name like "desktop|en|zoom_1".
 * Each part is classified by CONTENT (viewport word / language code / zoom_N) —
 * order and presence are flexible. Missing dimensions are simply omitted:
 *   "desktop|zoom_1" (no lang), "desktop|en" (no zoom), "desktop" (only viewport).
 * Returns null if the name has no "|" separator (not a v2 key).
 */
function parseCompositeKey(name: string): CompositeKey | null {
  if (!name.includes('|')) return null;
  const parts = name.split('|').map((p) => p.trim()).filter(Boolean);

  let viewport: 'mobile' | 'desktop' | null = null;
  let lang: string | null = null;
  let zoom: number | null = null;

  for (const part of parts) {
    if (nameIncludes(part, 'mobile') || nameIncludes(part, 'mob')) {
      viewport = 'mobile';
    } else if (nameIncludes(part, 'desktop') || nameIncludes(part, 'desk')) {
      viewport = 'desktop';
    } else if (getZoomLevel(part) !== null) {
      zoom = getZoomLevel(part);
    } else if (isLanguageCode(part)) {
      lang = part.toLowerCase();
    }
  }

  return { viewport, lang, zoom };
}

/** True if any direct child of the pins root uses a composite "a|b|c" name. */
function isV2Structure(pinsRoot: SceneNode): boolean {
  return getChildNodes(pinsRoot).some((c) => isVisible(c) && c.name.includes('|'));
}

interface V2Collection {
  dLeaves: PinLeaf[];
  mLeaves: PinLeaf[];
  flags: PinsStructureFlags;
}

/**
 * Collects pin leaves from a v2 (flat composite-key) structure.
 * Each root child "viewport|lang|zoom" → category groups → Pin instances.
 * Routes leaves into desktop/mobile buckets by the key's viewport part.
 */
async function getPinLeavesV2(pinsRoot: SceneNode, logs: LogEntry[]): Promise<V2Collection> {
  const dLeaves: PinLeaf[] = [];
  const mLeaves: PinLeaf[] = [];
  let hasViewports = false;
  let hasLanguages = false;
  let hasZooms = false;

  for (const comboGroup of getChildNodes(pinsRoot)) {
    if (!isVisible(comboGroup)) continue;
    const key = parseCompositeKey(comboGroup.name);
    if (!key) {
      logs.push({
        step: `  ⚠ Пропущена группа "${comboGroup.name.trim()}" — нет составного ключа "viewport|lang|zoom"`,
        status: 'warning',
      });
      continue;
    }

    if (key.viewport) hasViewports = true;
    if (key.lang) hasLanguages = true;
    if (key.zoom !== null) hasZooms = true;

    const lang = key.lang ?? 'en';
    const zoom = key.zoom ?? 0;

    const comboLeaves = await collectPinsFromContainer(comboGroup, lang, zoom, logs);
    if (key.viewport === 'mobile') {
      mLeaves.push(...comboLeaves);
    } else {
      // default to desktop (viewport absent or explicitly desktop)
      dLeaves.push(...comboLeaves);
    }
  }

  return {
    dLeaves,
    mLeaves,
    flags: { viewports: hasViewports, languages: hasLanguages, zooms: hasZooms },
  };
}

// ─── SVG naming ────────────────────────────────────────────

function getPinSvgName(groupCode: string, isMobile: boolean): string {
  // groupCode is already prefixed with "map_" → "map_pin_education[_mob]"
  const base = groupCode.replace(/^map_/, 'map_pin_');
  return isMobile ? `${base}_mob` : base;
}

// ─── Group assembly ────────────────────────────────────────

interface GroupCollector {
  /** ALL desktop leaves (duplicates by text allowed — different positions kept) */
  desktopLeaves: PinLeaf[];
  /** ALL mobile leaves */
  mobileLeaves: PinLeaf[];
  /** Ordered (text, lang, zoom) dimensions — first-seen wins, desktop first */
  textsInOrder: string[];
  langsInOrder: string[];
  zoomsInOrder: number[];
  textRaws: Map<string, string>;
}

function makeCollector(): GroupCollector {
  return {
    desktopLeaves: [],
    mobileLeaves: [],
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
  // Keep EVERY leaf — multiple pins with the same text live at different positions.
  if (fromDesktop) {
    collector.desktopLeaves.push(leaf);
  } else {
    collector.mobileLeaves.push(leaf);
  }
  pushIfNew(collector.textsInOrder, leaf.text);
  pushIfNew(collector.langsInOrder, leaf.lang);
  pushIfNew(collector.zoomsInOrder, leaf.zoom);
  if (!collector.textRaws.has(leaf.text)) collector.textRaws.set(leaf.text, leaf.textRaw);
}

// ─── Position-based desktop ↔ mobile pairing ───────────────

const leafCenterX = (l: PinLeaf) => l.iconBBox.x + l.iconBBox.width / 2;
const leafCenterY = (l: PinLeaf) => l.iconBBox.y + l.iconBBox.height / 2;

/**
 * Greedily pairs each desktop leaf to the NEAREST (by icon center) mobile leaf
 * within the same (text, lang, zoom) bucket. Leaves with no counterpart yield
 * a one-sided pair. Assumes desktop & mobile pins of the same place share a
 * comparable map coordinate space (true when viewports are overlaid).
 */
function pairLeavesByPosition(
  dBucket: PinLeaf[],
  mBucket: PinLeaf[]
): Array<{ d: PinLeaf | null; m: PinLeaf | null }> {
  const pairs: Array<{ d: PinLeaf | null; m: PinLeaf | null }> = [];
  const used = new Set<number>();

  for (const d of dBucket) {
    const dx = leafCenterX(d);
    const dy = leafCenterY(d);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < mBucket.length; i++) {
      if (used.has(i)) continue;
      const dist = (dx - leafCenterX(mBucket[i])) ** 2 + (dy - leafCenterY(mBucket[i])) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      pairs.push({ d, m: mBucket[bestIdx] });
    } else {
      pairs.push({ d, m: null });
    }
  }
  // Mobile leaves with no desktop counterpart
  for (let i = 0; i < mBucket.length; i++) {
    if (!used.has(i)) pairs.push({ d: null, m: mBucket[i] });
  }
  return pairs;
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
  const firstDesktopLeaf = collector.desktopLeaves[0] ?? null;
  const firstMobileLeaf = collector.mobileLeaves[0] ?? null;
  const primary = firstDesktopLeaf ?? firstMobileLeaf;
  if (!primary) {
    logs.push({ step: `  ⚠ "${groupNameRaw}" — нет пинов`, status: 'warning' });
    return null;
  }

  const desktopSvg = getPinSvgName(groupCode, false);
  const mobileSvg = getPinSvgName(groupCode, true);

  // Icon sizes — desktop from first desktop leaf (fallback to mobile), mobile from first mobile leaf (fallback to desktop)
  const dIcon = firstDesktopLeaf?.iconBBox ?? firstMobileLeaf!.iconBBox;
  const mIcon = firstMobileLeaf?.iconBBox ?? firstDesktopLeaf!.iconBBox;

  // SVG export — desktop node from first desktop leaf, mobile node from first mobile leaf
  if (firstDesktopLeaf) {
    svgExports.push({ name: desktopSvg, nodeId: firstDesktopLeaf.iconNode.id });
  } else if (firstMobileLeaf) {
    // No desktop — still export the desktop-named SVG from mobile node to keep config consistent
    svgExports.push({ name: desktopSvg, nodeId: firstMobileLeaf.iconNode.id });
  }
  if (firstMobileLeaf) {
    svgExports.push({ name: mobileSvg, nodeId: firstMobileLeaf.iconNode.id });
  } else if (firstDesktopLeaf) {
    svgExports.push({ name: mobileSvg, nodeId: firstDesktopLeaf.iconNode.id });
  }

  // Bucket filter: leaves matching a given (text, lang, zoom)
  const bucket = (leaves: PinLeaf[], text: string, lang: string, zoom: number) =>
    leaves.filter((l) => l.text === text && l.lang === lang && l.zoom === zoom);

  // Build pins[]: ordered by text → lang → zoom
  // Zoom levels sorted ascending — needed for minZoom/maxZoom (landmarks v1 logic)
  const sortedZooms = [...collector.zoomsInOrder].sort((a, b) => a - b);

  const pins: PinItem[] = [];
  for (const text of collector.textsInOrder) {
    for (const lang of collector.langsInOrder) {
      for (let zi = 0; zi < sortedZooms.length; zi++) {
        const zoom = sortedZooms[zi];
        const nextZoom = sortedZooms[zi + 1];

        const dBucket = bucket(collector.desktopLeaves, text, lang, zoom);
        const mBucket = bucket(collector.mobileLeaves, text, lang, zoom);
        if (dBucket.length === 0 && mBucket.length === 0) continue;

        // ── minZoom / maxZoom (landmarks v1 logic) — computed at (text, lang) level ──
        // Only emitted when zoom layers exist in Figma.
        // - minZoom: only for levels > 1 (level 1 = visible from the start)
        // - maxZoom: only when next zoom level exists AND this (text, lang) is NOT in it
        //            → "N.99" (visible up to just before next level); else omitted
        let minZoom: number | undefined;
        let maxZoom: number | undefined;
        if (flags.zooms) {
          if (zoom > 1) minZoom = zoom;
          if (nextZoom !== undefined) {
            const existsInNext =
              bucket(collector.desktopLeaves, text, lang, nextZoom).length > 0 ||
              bucket(collector.mobileLeaves, text, lang, nextZoom).length > 0;
            if (!existsInNext) maxZoom = parseFloat(`${zoom}.99`);
          }
        }

        // Pair desktop ↔ mobile within this bucket by nearest position —
        // multiple same-text pins in different places become separate items.
        const pairs = pairLeavesByPosition(dBucket, mBucket);

        for (const { d, m } of pairs) {
          const primaryLeaf = d ?? m!;
          const mobileLeaf = m ?? d!;

          const item: PinItem = {
            language: flags.languages ? [lang] : undefined,
            minZoom,
            maxZoom,
            left: round2(leafCenterX(primaryLeaf) - originX),
            top: round2(leafCenterY(primaryLeaf) - originY),
            isRight: primaryLeaf.isRight,
            text,
            breakpoints: {
              768: {
                left: round2(leafCenterX(mobileLeaf) - originX),
                top: round2(leafCenterY(mobileLeaf) - originY),
                isRight: mobileLeaf.isRight,
              },
            },
          };
          pins.push(item);
        }

        const langNote = flags.languages ? ` [${lang}]` : '';
        const zoomNote = flags.zooms ? ` zoom:${zoom}` : '';
        const rangeNote =
          flags.zooms && (minZoom !== undefined || maxZoom !== undefined)
            ? ` (${minZoom ?? '-'}..${maxZoom ?? '-'})`
            : '';
        const rawName = collector.textRaws.get(text) ?? text;
        logs.push({
          step: `  ✓ ${groupNameRaw} → "${rawName.replace(/\s+/g, ' ').trim()}" ×${pairs.length}${langNote}${zoomNote}${rangeNote}`,
          status: 'success',
        });
      }
    }
  }

  if (pins.length === 0) return null;

  // Colors — from first desktop leaf (or mobile fallback) for base,
  // from first mobile leaf (or desktop fallback) for breakpoint
  const baseLeaf = firstDesktopLeaf ?? firstMobileLeaf!;
  const mobLeaf = firstMobileLeaf ?? firstDesktopLeaf!;

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

  const { originX, originY } = getMapOrigin(pinsFrame, logs);

  // Two supported structures, auto-detected:
  //  • v2 (flat): root → "viewport|lang|zoom" → category → Pin
  //  • nested:    root → Viewport → [lang] → [zoom] → [category] → Pin
  let dLeaves: PinLeaf[];
  let mLeaves: PinLeaf[];
  let flags: PinsStructureFlags;

  if (isV2Structure(pinsFrame)) {
    const v2 = await getPinLeavesV2(pinsFrame, logs);
    dLeaves = v2.dLeaves;
    mLeaves = v2.mLeaves;
    flags = v2.flags;
    const parts = [
      flags.viewports ? 'Viewports' : null,
      flags.languages ? 'Languages' : null,
      flags.zooms ? 'Zooms' : null,
    ].filter(Boolean);
    logs.push({
      step: `Структура: v2 (составной ключ) — ${parts.join(' + ') || 'плоская'}`,
      status: 'info',
    });
  } else {
    const profile = detectPinsStructure(pinsFrame);
    logs.push({ step: `Структура: вложенная — ${profile.variantLabel}`, status: 'info' });

    if (profile.variant === 'unknown') {
      errors.push(
        'Не удалось определить структуру. Ожидаются Viewports (Mobile / Desktop) ' +
          'или составные ключи вида "viewport|lang|zoom".'
      );
      return { output: null, svgConfig: null, svgExports: null, logs, errors };
    }

    flags = profile.flags;
    const { mobile, desktop } = findPinsViewports(pinsFrame);
    dLeaves = desktop ? await getPinLeaves(desktop, flags, 'en', logs) : [];
    mLeaves = mobile ? await getPinLeaves(mobile, flags, 'en', logs) : [];
  }

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
