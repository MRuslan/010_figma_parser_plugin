/// <reference types="@figma/plugin-typings" />

import { parseLandmarks } from './landmarks';
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
  // Future schemas go here...
];

export function getSchema(id: string): Schema | null {
  return SCHEMAS.find((s) => s.id === id) ?? null;
}

export function getSchemasInfo(): SchemaInfo[] {
  return SCHEMAS.map(({ id, name, description }) => ({ id, name, description }));
}
