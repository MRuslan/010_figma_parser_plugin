// ============================================================
// Shared types between plugin code (sandbox) and UI
// ============================================================

export type ParsingSchemaId = string;

// ─── Schema info (sent from plugin → UI on startup) ────────
export interface SchemaInfo {
  id: ParsingSchemaId;
  name: string;
  description: string;
}

// ─── Log entry (progress step) ─────────────────────────────
export type LogStatus = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  step: string;
  status: LogStatus;
}

// ─── SVG export item ───────────────────────────────────────
export interface SvgExportItem {
  name: string;     // svg filename without extension, e.g. "yas_waterworld_mob"
  nodeId: string;   // Figma node ID of the bubble instance
}

// ─── Parser result (internal, returned by schema.parse()) ──
export interface ParseResult {
  output: string | null;      // formatted JS object string, or null on failure
  svgConfig: string | null;   // SVG paths config JS string, or null if no SVGs
  svgExports: SvgExportItem[] | null; // list of SVG files to export, or null
  logs: LogEntry[];
  errors: string[];
}

// ─── Messages: UI → Plugin ─────────────────────────────────
export type MessageToPlugin =
  | { type: 'GET_SELECTION' }
  | { type: 'GET_SCHEMAS' }
  | { type: 'PARSE'; schemaId: ParsingSchemaId }
  | { type: 'DOWNLOAD_SVGS'; exports: SvgExportItem[] }
  | { type: 'CLOSE' };

// ─── Messages: Plugin → UI ─────────────────────────────────
export type MessageToUI =
  | { type: 'SELECTION_DATA'; data: FigmaNodeInfo | null }
  | { type: 'SCHEMAS_LIST'; schemas: SchemaInfo[] }
  | { type: 'PARSE_PROGRESS'; step: string; status: LogStatus }
  | { type: 'PARSE_RESULT'; output: string | null; svgConfig: string | null; svgExports: SvgExportItem[] | null; errors: string[] }
  | { type: 'SVG_EXPORT_PROGRESS'; done: number; total: number; currentName: string }
  | { type: 'SVG_DATA'; files: { name: string; data: number[] }[] }
  | { type: 'ERROR'; message: string };

// ─── Lightweight Figma node representation ─────────────────
export interface FigmaNodeInfo {
  id: string;
  name: string;
  type: string;
  children?: FigmaNodeInfo[];
}
