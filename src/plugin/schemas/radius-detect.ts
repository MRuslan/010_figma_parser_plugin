/// <reference types="@figma/plugin-typings" />

import { isLanguageCode, nameIncludes } from '../utils';
import { getChildNodes } from './landmarks-common';

// ─── Structure types ───────────────────────────────────────

export interface RadiusStructureFlags {
  viewports: boolean;
  languages: boolean;
}

export type RadiusVariant = 'viewports' | 'viewports+languages' | 'unknown';

export interface RadiusStructureProfile {
  flags: RadiusStructureFlags;
  variant: RadiusVariant;
  variantLabel: string;
}

// ─── Viewport finder ───────────────────────────────────────

/** Finds Mobile and Desktop viewports inside a project group */
export function findRadiusViewports(projectGroup: SceneNode): {
  mobile: SceneNode | null;
  desktop: SceneNode | null;
} {
  let mobile: SceneNode | null = null;
  let desktop: SceneNode | null = null;

  for (const child of getChildNodes(projectGroup)) {
    const n = child.name;
    if (nameIncludes(n, 'mobile') || nameIncludes(n, 'mob')) {
      mobile = child;
    } else if (nameIncludes(n, 'desktop') || nameIncludes(n, 'desk')) {
      desktop = child;
    }
  }

  return { mobile, desktop };
}

/** All direct project child groups inside the Radius container */
export function getRadiusProjectGroups(radiusFrame: SceneNode): SceneNode[] {
  return getChildNodes(radiusFrame);
}

// ─── Detection helpers ─────────────────────────────────────

function hasLanguageLayers(frame: SceneNode): boolean {
  return getChildNodes(frame).some((c) => isLanguageCode(c.name));
}

function resolveVariant(flags: RadiusStructureFlags): RadiusVariant {
  if (flags.viewports && flags.languages) return 'viewports+languages';
  if (flags.viewports) return 'viewports';
  return 'unknown';
}

function buildVariantLabel(variant: RadiusVariant): string {
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
 * Detects which Radius export path to use based on optional layers
 * (Viewports, Languages) inside the first project group.
 * No Zoom support — radii are zoom-independent.
 */
export function detectRadiusStructure(radiusFrame: SceneNode): RadiusStructureProfile {
  const firstProject = getRadiusProjectGroups(radiusFrame)[0];

  const flags: RadiusStructureFlags = {
    viewports: false,
    languages: false,
  };

  if (firstProject) {
    const { mobile, desktop } = findRadiusViewports(firstProject);
    flags.viewports = !!(mobile || desktop);

    const sampleViewport = mobile ?? desktop;
    if (sampleViewport) {
      flags.languages = hasLanguageLayers(sampleViewport);
    }
  }

  const variant = resolveVariant(flags);
  return { flags, variant, variantLabel: buildVariantLabel(variant) };
}

/**
 * Finds the radius element node inside a viewport or language frame.
 * Handles both:
 *   - Desktop: BOOLEAN_OPERATION "Radius" as direct child of lang frame
 *   - Mobile:  GROUP "Radius" wrapping the actual elements + km labels + ellipse
 */
export function findRadiusNode(container: SceneNode): SceneNode | null {
  for (const child of getChildNodes(container)) {
    if (nameIncludes(child.name, 'radius')) return child;
  }
  return null;
}
