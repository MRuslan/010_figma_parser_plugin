/// <reference types="@figma/plugin-typings" />

import { getZoomLevel, isLanguageCode, nameIncludes } from '../utils';
import { findViewportFrames, getChildNodes, isViewportFrameName } from './landmarks-common';

/** Optional layers in the v2 landmarks tree */
export interface LandmarksStructureFlags {
  viewports: boolean;
  languages: boolean;
  zooms: boolean;
}

/** Detected v2 export path (by optional layers) */
export type LandmarksV2Variant =
  | 'viewports'
  | 'viewports+languages'
  | 'viewports+zooms'
  | 'viewports+languages+zooms'
  | 'unknown';

export interface LandmarksV2StructureProfile {
  flags: LandmarksStructureFlags;
  variant: LandmarksV2Variant;
  variantLabel: string;
}

function hasLanguageLayers(frame: SceneNode): boolean {
  return getChildNodes(frame).some((c) => isLanguageCode(c.name));
}

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

function resolveVariant(flags: LandmarksStructureFlags): LandmarksV2Variant {
  const { viewports, languages, zooms } = flags;

  if (viewports && languages && zooms) return 'viewports+languages+zooms';
  if (viewports && languages) return 'viewports+languages';
  if (viewports && zooms) return 'viewports+zooms';
  if (viewports) return 'viewports';
  return 'unknown';
}

function buildVariantLabel(variant: LandmarksV2Variant): string {
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
 * Detects which v2 export path to use based on optional layers
 * (Viewports, Languages, Zooms) inside the landmarks tree.
 */
export function detectV2Structure(landmarksFrame: SceneNode): LandmarksV2StructureProfile {
  const { mobile, desktop } = findViewportFrames(landmarksFrame);
  const sampleViewport = mobile ?? desktop;

  const flags: LandmarksStructureFlags = {
    viewports: !!(mobile || desktop),
    languages: false,
    zooms: false,
  };

  if (sampleViewport) {
    flags.languages = hasLanguageLayers(sampleViewport);
    flags.zooms = hasZoomLayers(sampleViewport);
  }

  const variant = resolveVariant(flags);

  return {
    flags,
    variant,
    variantLabel: buildVariantLabel(variant),
  };
}

/** All language layer frames under a viewport (e.g. "en", "ar") */
export function getLanguageFrames(parent: SceneNode): SceneNode[] {
  return getChildNodes(parent).filter((c) => isLanguageCode(c.name));
}

/** All zoom layer frames under a parent, sorted by level ascending */
export function getZoomFrames(parent: SceneNode): SceneNode[] {
  return getChildNodes(parent)
    .filter((c) => getZoomLevel(c.name) !== null)
    .sort((a, b) => getZoomLevel(a.name)! - getZoomLevel(b.name)!);
}

export function isLandmarkContainerCandidate(node: SceneNode): boolean {
  const name = node.name;
  if (isViewportFrameName(name)) return false;
  if (isLanguageCode(name)) return false;
  if (getZoomLevel(name) !== null) return false;
  if (nameIncludes(name, 'line') && node.type === 'FRAME') return false;
  return true;
}

export function findLabelFrame(landmark: SceneNode): SceneNode | null {
  for (const child of getChildNodes(landmark)) {
    if (nameIncludes(child.name, 'label')) {
      return child;
    }
  }
  return null;
}

/** Direct Anchor ellipse child (Line frame is ignored) */
export function findDirectAnchor(landmark: SceneNode): EllipseNode | null {
  for (const child of getChildNodes(landmark)) {
    if (nameIncludes(child.name, 'anchor') && child.type === 'ELLIPSE') {
      return child as EllipseNode;
    }
  }
  return null;
}
