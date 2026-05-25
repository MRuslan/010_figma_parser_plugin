/// <reference types="@figma/plugin-typings" />

import { isLanguageCode, nameIncludes, getZoomLevel } from '../utils';
import { getChildNodes } from './landmarks-common';

// ─── Structure types ───────────────────────────────────────

export interface PinsStructureFlags {
  viewports: boolean;
  languages: boolean;
  zooms: boolean;
}

export type PinsVariant =
  | 'viewports'
  | 'viewports+languages'
  | 'viewports+zooms'
  | 'viewports+languages+zooms'
  | 'unknown';

export interface PinsStructureProfile {
  flags: PinsStructureFlags;
  variant: PinsVariant;
  variantLabel: string;
}

// ─── Viewport finder ───────────────────────────────────────

/** Finds Mobile and Desktop viewports inside the Pins container */
export function findPinsViewports(node: SceneNode): {
  mobile: SceneNode | null;
  desktop: SceneNode | null;
} {
  let mobile: SceneNode | null = null;
  let desktop: SceneNode | null = null;

  for (const child of getChildNodes(node)) {
    const n = child.name;
    if (nameIncludes(n, 'mobile') || nameIncludes(n, 'mob')) {
      mobile = child;
    } else if (nameIncludes(n, 'desktop') || nameIncludes(n, 'desk')) {
      desktop = child;
    }
  }

  return { mobile, desktop };
}

// ─── Detection helpers ─────────────────────────────────────

function hasLanguageLayers(frame: SceneNode): boolean {
  return getChildNodes(frame).some((c) => isLanguageCode(c.name));
}

/**
 * Checks for zoom layers in the viewport (or inside language groups).
 * Handles both: viewport → zoom_N and viewport → lang → zoom_N.
 */
function hasZoomLayers(frame: SceneNode): boolean {
  for (const child of getChildNodes(frame)) {
    if (getZoomLevel(child.name) !== null) return true;
    if (isLanguageCode(child.name)) {
      for (const nested of getChildNodes(child)) {
        if (getZoomLevel(nested.name) !== null) return true;
      }
    }
  }
  return false;
}

function resolveVariant(flags: PinsStructureFlags): PinsVariant {
  const { viewports, languages, zooms } = flags;
  if (viewports && languages && zooms) return 'viewports+languages+zooms';
  if (viewports && languages) return 'viewports+languages';
  if (viewports && zooms) return 'viewports+zooms';
  if (viewports) return 'viewports';
  return 'unknown';
}

function buildVariantLabel(variant: PinsVariant): string {
  switch (variant) {
    case 'viewports':
      return 'Viewports';
    case 'viewports+languages':
      return 'Viewports + Languages';
    case 'viewports+zooms':
      return 'Viewports + Zooms';
    case 'viewports+languages+zooms':
      return 'Viewports + Languages + Zooms';
    default:
      return 'неизвестно';
  }
}

/**
 * Detects which Pins export path to use based on optional layers
 * (Viewports, Languages, Zooms) inside the first viewport.
 */
export function detectPinsStructure(pinsFrame: SceneNode): PinsStructureProfile {
  const flags: PinsStructureFlags = {
    viewports: false,
    languages: false,
    zooms: false,
  };

  const { mobile, desktop } = findPinsViewports(pinsFrame);
  flags.viewports = !!(mobile || desktop);

  const sampleViewport = desktop ?? mobile;
  if (sampleViewport) {
    flags.languages = hasLanguageLayers(sampleViewport);
    flags.zooms = hasZoomLayers(sampleViewport);
  }

  const variant = resolveVariant(flags);
  return { flags, variant, variantLabel: buildVariantLabel(variant) };
}
