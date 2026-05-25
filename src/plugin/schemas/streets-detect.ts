/// <reference types="@figma/plugin-typings" />

import { isLanguageCode, nameIncludes } from '../utils';
import { getChildNodes } from './landmarks-common';

// ─── Structure types ───────────────────────────────────────

export interface StreetsStructureFlags {
  viewports: boolean;
  languages: boolean;
}

export type StreetsVariant = 'viewports' | 'viewports+languages' | 'unknown';

export interface StreetsStructureProfile {
  flags: StreetsStructureFlags;
  variant: StreetsVariant;
  variantLabel: string;
}

// ─── Viewport finder ───────────────────────────────────────

/** Finds Mobile and Desktop viewports inside the Streets container */
export function findStreetsViewports(node: SceneNode): {
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

function resolveVariant(flags: StreetsStructureFlags): StreetsVariant {
  if (flags.viewports && flags.languages) return 'viewports+languages';
  if (flags.viewports) return 'viewports';
  return 'unknown';
}

function buildVariantLabel(variant: StreetsVariant): string {
  switch (variant) {
    case 'viewports':
      return 'Viewports';
    case 'viewports+languages':
      return 'Viewports + Languages';
    default:
      return 'неизвестно';
  }
}

/**
 * Detects which Streets export path to use based on optional layers
 * (Viewports, Languages) inside the first viewport.
 * No Zoom support — streets are zoom-independent.
 */
export function detectStreetsStructure(streetsFrame: SceneNode): StreetsStructureProfile {
  const flags: StreetsStructureFlags = {
    viewports: false,
    languages: false,
  };

  const { mobile, desktop } = findStreetsViewports(streetsFrame);
  flags.viewports = !!(mobile || desktop);

  const sampleViewport = mobile ?? desktop;
  if (sampleViewport) {
    flags.languages = hasLanguageLayers(sampleViewport);
  }

  const variant = resolveVariant(flags);
  return { flags, variant, variantLabel: buildVariantLabel(variant) };
}
