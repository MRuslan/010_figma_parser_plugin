/// <reference types="@figma/plugin-typings" />

import { parseLandmarks } from './landmarks';
import { parseLandmarksV2 } from './landmarks-v2';
import { parseProjects } from './projects';
import { parsePaths } from './paths';
import { parseRadius } from './radius';
import type { ParseResult, SchemaInfo } from '../types';

// ─── Schema registry ───────────────────────────────────────

export interface Schema {
  id: string;
  name: string;
  description: string;
  parse: (node: SceneNode) => ParseResult;
}

export const SCHEMAS: Schema[] = [
  {
    id: 'landmarks',
    name: 'Map Landmarks',
    description: 'Парсит группу Landmarks с Mobile/Desktop версиями в конфиг map_landmarks',
    parse: parseLandmarks,
  },
  {
    id: 'landmarks-v2',
    name: 'Map Landmarks v2',
    description:
      'Label + Anchor. Авто-определение Viewports / Languages / Zooms (4 варианта структуры)',
    parse: parseLandmarksV2,
  },
  {
    id: 'projects',
    name: 'Map Projects',
    description:
      'Zone + Label + Anchor. Авто-определение Viewports / Languages / Zooms (4 варианта структуры)',
    parse: parseProjects,
  },
  {
    id: 'paths',
    name: 'Map Paths',
    description:
      'Пути от проектов к лендмаркам. Структура: Paths → {from_project} → {to_landmark}',
    parse: parsePaths,
  },
  {
    id: 'radius',
    name: 'Map Radius',
    description:
      'Радиусы расстояний от проектов. Структура: Radius → {project} → Mobile/Desktop → [lang]. Авто-определение Viewports / Languages (2 варианта)',
    parse: parseRadius,
  },
];

export function getSchema(id: string): Schema | null {
  return SCHEMAS.find((s) => s.id === id) ?? null;
}

export function getSchemasInfo(): SchemaInfo[] {
  return SCHEMAS.map(({ id, name, description }) => ({ id, name, description }));
}
