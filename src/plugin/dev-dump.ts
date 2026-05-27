/// <reference types="@figma/plugin-typings" />

import { round2 } from './utils';
import type { StructureDumpBBox, StructureDumpNode, StructureDumpResult } from './types';

export interface DumpStructureOptions {
  /** 0 = unlimited depth */
  maxDepth: number;
  includeHidden: boolean;
  includeBBox: boolean;
}

const DEFAULT_OPTIONS: DumpStructureOptions = {
  maxDepth: 30,
  includeHidden: false,
  includeBBox: true,
};

export function normalizeDumpOptions(
  partial?: Partial<DumpStructureOptions>
): DumpStructureOptions {
  return {
    maxDepth: partial?.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    includeHidden: partial?.includeHidden ?? DEFAULT_OPTIONS.includeHidden,
    includeBBox: partial?.includeBBox ?? DEFAULT_OPTIONS.includeBBox,
  };
}

function getBBox(node: SceneNode): StructureDumpBBox | null {
  const box = node.absoluteBoundingBox;
  if (!box) return null;
  return {
    x: round2(box.x),
    y: round2(box.y),
    width: round2(box.width),
    height: round2(box.height),
  };
}

async function dumpNode(
  node: SceneNode,
  options: DumpStructureOptions,
  depth: number
): Promise<StructureDumpNode> {
  const entry: StructureDumpNode = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if ('visible' in node) {
    entry.visible = node.visible;
  }

  if (options.includeBBox) {
    entry.bbox = getBBox(node);
  }

  if (node.type === 'INSTANCE') {
    try {
      // Async required with documentAccess: dynamic-page
      const main = await (node as InstanceNode).getMainComponentAsync();
      if (main) {
        entry.component = main.name;
      }
    } catch {
      // Silently skip — component info is optional metadata for the dump
    }
  }

  const hasChildren = 'children' in node;
  const atDepthLimit = options.maxDepth > 0 && depth >= options.maxDepth;

  if (hasChildren && atDepthLimit) {
    const parent = node as ChildrenMixin;
    if (parent.children.length > 0) {
      entry.childrenTruncated = true;
      entry.childrenCount = parent.children.length;
    }
    return entry;
  }

  if (hasChildren) {
    const parent = node as ChildrenMixin;
    const children: StructureDumpNode[] = [];

    for (const child of parent.children) {
      if (!options.includeHidden && 'visible' in child && !child.visible) {
        continue;
      }
      children.push(await dumpNode(child as SceneNode, options, depth + 1));
    }

    if (children.length > 0) {
      entry.children = children;
    }
  }

  return entry;
}

function countNodes(node: StructureDumpNode): number {
  let n = 1;
  if (node.children) {
    for (const child of node.children) {
      n += countNodes(child);
    }
  }
  return n;
}

export async function dumpStructure(
  root: SceneNode,
  partialOptions?: Partial<DumpStructureOptions>
): Promise<StructureDumpResult> {
  const options = normalizeDumpOptions(partialOptions);
  const tree = await dumpNode(root, options, 0);
  const nodeCount = countNodes(tree);

  return {
    root: tree,
    meta: {
      dumpedAt: new Date().toISOString(),
      selectionName: root.name,
      selectionType: root.type,
      nodeCount,
      maxDepth: options.maxDepth,
      includeHidden: options.includeHidden,
      includeBBox: options.includeBBox,
    },
  };
}
