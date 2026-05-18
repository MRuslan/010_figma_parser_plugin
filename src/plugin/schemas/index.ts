/// <reference types="@figma/plugin-typings" />

import { parseLandmarks } from './landmarks';
import { parseLandmarksV2 } from './landmarks-v2';
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
];

export function getSchema(id: string): Schema | null {
  return SCHEMAS.find((s) => s.id === id) ?? null;
}

export function getSchemasInfo(): SchemaInfo[] {
  return SCHEMAS.map(({ id, name, description }) => ({ id, name, description }));
}
