// ============================================================
// Shared utility functions for plugin parsing
// ============================================================

/**
 * Normalizes a layer name for searching/matching:
 * trims, lowercases, collapses spaces AND underscores into a single space.
 * "Landmarks_Mobile" → "landmarks mobile"
 * "Zoom_2 " → "zoom 2"
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

/** Check if a layer name contains a word (case/space/underscore-insensitive). */
export function nameIncludes(layerName: string, word: string): boolean {
  return normalizeName(layerName).includes(word.toLowerCase());
}

/**
 * Converts a Figma layer name to a slug-style code.
 * Handles trailing/leading spaces, double spaces, underscores, special chars.
 * "The Dubai Mall"  → "the_dubai_mall"
 * "Burj Khalifa "   → "burj_khalifa"
 * "Yas Mall  "      → "yas_mall"
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '_')        // any whitespace or underscore sequence → _
    .replace(/[^a-z0-9_]/g, '')     // remove non-alphanumeric
    .replace(/_+/g, '_')            // collapse multiple underscores
    .replace(/^_|_$/g, '');         // strip leading/trailing underscores
}

/** Round a number to 2 decimal places, dropping trailing zeros. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Language helpers ─────────────────────────────────────

/**
 * Checks if a frame name looks like an ISO language code ("en", "ar", "ru", etc.)
 * Used to detect optional language layers inside viewport frames.
 */
export function isLanguageCode(name: string): boolean {
  return /^[a-z]{2,3}$/.test(name.trim().toLowerCase());
}

/**
 * Returns the language-aware SVG filename.
 * en + mobile  → "{code}_mob"
 * en + desktop → "{code}"
 * ar + mobile  → "{code}_ar_mob"
 * ar + desktop → "{code}_ar"
 */
export function getSvgName(code: string, language: string, isMobile: boolean): string {
  const langSuffix = language === 'en' ? '' : `_${language}`;
  return isMobile ? `${code}${langSuffix}_mob` : `${code}${langSuffix}`;
}

// ─── Zoom helpers ─────────────────────────────────────────

/**
 * Extracts the zoom level number from a frame name.
 * "Zoom 1" → 1, "zoom_2" → 2, "Zoom  3" → 3, "regular frame" → null
 */
export function getZoomLevel(name: string): number | null {
  const normalized = normalizeName(name);
  const match = normalized.match(/^zoom\s+(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// ─── Fuzzy landmark matching ──────────────────────────────

/** Levenshtein edit distance between two strings (O(n) space). */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1]
        ? row[j - 1]
        : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

/**
 * Checks whether two landmark codes refer to the same landmark.
 * Stage 1: strip all non-alphanumeric chars and compare (handles spaces/underscores/typos near separators).
 * Stage 2: Levenshtein with adaptive threshold (20% of max length, minimum 2).
 */
export function isSameLandmark(code1: string, code2: string): boolean {
  const strip = (s: string) => s.replace(/[^a-z0-9]/g, '');
  const n1 = strip(code1);
  const n2 = strip(code2);
  if (n1 === n2) return true;

  const maxLen = Math.max(n1.length, n2.length);
  const threshold = Math.max(2, Math.floor(maxLen * 0.2));
  return levenshtein(n1, n2) <= threshold;
}

// ─── JS object formatter ──────────────────────────────────

/**
 * Formats a JavaScript value as a pretty JS object literal (not JSON):
 * - Keys without quotes
 * - Tab indentation
 * - Trailing commas
 * - undefined values are omitted
 */
export function toJSObject(value: unknown, indent = 1): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);

  const tab = '\t'.repeat(indent);
  const closingTab = '\t'.repeat(indent - 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${tab}${toJSObject(item, indent + 1)}`);
    return `[\n${items.join(',\n')},\n${closingTab}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${tab}${k}: ${toJSObject(v, indent + 1)},`);
    if (entries.length === 0) return '{}';
    return `{\n${entries.join('\n')}\n${closingTab}}`;
  }

  return String(value);
}

/** Wraps the output as `export default { key: value };` */
export function wrapExport(key: string, value: unknown): string {
  return `export default {\n\t${key}: ${toJSObject(value, 2)},\n};\n`;
}
