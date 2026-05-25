/// <reference types="@figma/plugin-typings" />

import { getZoomLevel, isLanguageCode, nameIncludes } from '../utils';
import { getChildNodes } from './landmarks-common';

export interface ProjectsStructureFlags {
  viewports: boolean;
  languages: boolean;
  zooms: boolean;
}

export type ProjectsVariant =
  | 'viewports'
  | 'viewports+languages'
  | 'viewports+zooms'
  | 'viewports+languages+zooms'
  | 'unknown';

export interface ProjectsStructureProfile {
  flags: ProjectsStructureFlags;
  variant: ProjectsVariant;
  variantLabel: string;
}

export function isProjectZoneName(name: string): boolean {
  return nameIncludes(name, 'zone');
}

/** Finds Project_Mobile and Project_Desktop inside a project group */
export function findProjectViewports(projectGroup: SceneNode): {
  mobile: SceneNode | null;
  desktop: SceneNode | null;
} {
  let mobile: SceneNode | null = null;
  let desktop: SceneNode | null = null;

  for (const child of getChildNodes(projectGroup)) {
    if (isProjectZoneName(child.name)) continue;
    const n = child.name;
    if (nameIncludes(n, 'mobile') || nameIncludes(n, 'mob')) {
      mobile = child;
    } else if (nameIncludes(n, 'desktop') || nameIncludes(n, 'desk')) {
      desktop = child;
    }
  }

  return { mobile, desktop };
}

/** All direct project child groups inside the Projects container */
export function getProjectGroups(projectsFrame: SceneNode): SceneNode[] {
  return getChildNodes(projectsFrame);
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

function resolveVariant(flags: ProjectsStructureFlags): ProjectsVariant {
  const { viewports, languages, zooms } = flags;
  if (viewports && languages && zooms) return 'viewports+languages+zooms';
  if (viewports && languages) return 'viewports+languages';
  if (viewports && zooms) return 'viewports+zooms';
  if (viewports) return 'viewports';
  return 'unknown';
}

function buildVariantLabel(variant: ProjectsVariant): string {
  switch (variant) {
    case 'viewports': return 'Viewports';
    case 'viewports+languages': return 'Viewports + Languages';
    case 'viewports+zooms': return 'Viewports + Zooms';
    case 'viewports+languages+zooms': return 'Viewports + Languages + Zooms';
    default: return 'неизвестно';
  }
}

/**
 * Detects which Projects export path to use based on optional layers
 * (Viewports, Languages, Zooms) inside the first project group.
 */
export function detectProjectsStructure(projectsFrame: SceneNode): ProjectsStructureProfile {
  const firstProject = getProjectGroups(projectsFrame)[0];

  const flags: ProjectsStructureFlags = {
    viewports: false,
    languages: false,
    zooms: false,
  };

  if (firstProject) {
    const { mobile, desktop } = findProjectViewports(firstProject);
    flags.viewports = !!(mobile || desktop);

    const sampleViewport = mobile ?? desktop;
    if (sampleViewport) {
      flags.languages = hasLanguageLayers(sampleViewport);
      flags.zooms = hasZoomLayers(sampleViewport);
    }
  }

  const variant = resolveVariant(flags);
  return { flags, variant, variantLabel: buildVariantLabel(variant) };
}
