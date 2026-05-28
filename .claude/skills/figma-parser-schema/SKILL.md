---
name: figma-parser-schema
description: Use this skill whenever the user wants to add a NEW parsing target (schema) to this Figma parser plugin codebase. Trigger phrases include "сделай выгрузку для X", "новая схема парсинга", "добавь схему для Y", "сделать парсер X", "добавь еще один компонент выгрузки", "add new parser schema", "extend the figma parser with X". Use this even when the user says "сделай новую выгрузку" or "парсер компонент" without explicitly saying "schema". Trigger as soon as the user provides a Figma structure dump or describes a new component category they want parsed into a JS config. The skill orchestrates: reading the project's SCHEMA_GUIDE.md conventions, gathering the new schema's structure + expected output from the user, generating the detect.ts + parser files, registering in the schema index, updating CLAUDE.md and SCHEMA_GUIDE.md docs, and verifying with `npx tsc --noEmit`. Do NOT trigger for: bug fixes in existing schemas, UI changes, or general TypeScript questions unrelated to creating a new schema.
---

# Figma Parser — New Schema Workflow

You are extending **this codebase** (`010_figma_parser_plugin`) with a new parser schema. The codebase has a strict, well-documented pattern for adding schemas. Your job is to follow it precisely, not to reinvent it.

## The source of truth

**Read `SCHEMA_GUIDE.md` in the repo root first.** It has:
- **Часть 1**: every existing schema (landmarks v1/v2, projects, paths, radius, streets, districts, pins) with full structure diagrams, output examples, field tables, and peculiarities. Use these as templates for analogous structures.
- **Часть 2 — Правила создания новых схем**: 11 rules covering file structure, detector pattern, frame discovery, coordinates, leaf extraction, SVG exports, naming, output format, logging, reusable utilities, and the pre-PR checklist.
- **Быстрый старт для новой схемы**: the canonical 7-step ordered list of files to touch.

**Read `CLAUDE.md`** for the project-wide structure overview, message types (`MessageToPlugin` / `MessageToUI`), and the `ParseResult` interface contract.

These two files are the spec. Don't paraphrase them into your output — *follow* them. If a rule says "always X", do X.

## What to gather from the user

Before generating anything, collect:

1. **Schema id** (kebab-case slug for code, e.g. `buildings`, `transport-lines`) and **human-readable name** (e.g. "Map Buildings"). Confirm both.
2. **Figma structure dump** — ask for path to `examples/dumps/{name}.json` or pasted JSON. If the user already shared one in the conversation, use it without re-asking.
3. **Expected output example** — ideally `examples/{name}.js` or pasted snippet. This pins down field names, ordering, breakpoint shape, and SVG references.
4. **Which dimensions apply**:
   - **Viewports** (Mobile/Desktop) — almost always yes
   - **Languages** (en/ar/…) — does the same element render with different text per language?
   - **Zooms** (Zoom_1/Zoom_2/…) — do positions/visibility change between zoom levels?
   - **v2 flat key** (`"desktop|en|zoom_1"`) — like the pins schema; ask if user prefers this for new schemas with all 3 dimensions
5. **SVG conventions** if the schema produces SVG exports — naming pattern (`{code}_thing[_{lang}][_mob]`, `{code}_zone`, etc.) and the subfolder name for the config path.

If anything is ambiguous after reading the dump, ask focused questions. Don't ask a long list — ask only what's blocking.

## Generation order (mirror Быстрый старт)

Generate in this exact order; each step usually depends on previous decisions:

1. **`examples/dumps/{name}.json`** — if user shared structure but not as a file, save it (handy for re-runs and as a regression artifact). If they pointed to an existing path, skip.
2. **`examples/{name}.js`** — the expected output as a bare object/array literal. **No `export default` wrapper** — the parser outputs bare values now. Use tab indentation matching other examples.
3. **`src/plugin/schemas/{name}-detect.ts`** — only if the schema has variant structure (viewports / languages / zooms / combinations). Skip for fixed structures like `paths`. Follow Правило 2 in SCHEMA_GUIDE.md; mirror the most similar existing detector (`districts-detect.ts`, `radius-detect.ts`, `streets-detect.ts`).
4. **`src/plugin/schemas/{name}.ts`** — the parser. Mirror the most similar existing parser. The most modern patterns (color extraction, async parse via `getMainComponentAsync`, v2 composite key, position-based pairing for duplicate-text support) live in `pins.ts` — use it as a reference if your new schema needs any of these features.
5. **`src/plugin/schemas/index.ts`** — import `parse{Name}` and add a `SCHEMAS[]` entry with `id`, `name`, `description`, `parse`.
6. **`CLAUDE.md`** — append the new files to the file-structure block AND add a row to the schema registry table at the bottom. Russian language, matching existing emoji/markdown style.
7. **`SCHEMA_GUIDE.md`** — add a new "Схема N: Map {Thing}" section in Part 1 *before* "Часть 2 — Правила создания новых схем". Use the same anatomy as the surrounding schemas: ID + files header, Figma structure diagram, output structure example, per-group/per-element fields tables, SVG naming, ordering, peculiarities, structure variants table.

## Non-negotiable conventions

These come from the codebase, not from this skill. Enforce them silently — don't explain them to the user unless they ask:

- **Async-aware parse:** `Schema.parse` may return `ParseResult | Promise<ParseResult>`. Use `async` if you need `getMainComponentAsync` or other async Figma APIs.
- **Bare output:** `wrapExport(key, value)` produces a bare object/array literal — no `export default` wrapper, no outer key. Same for `buildSvgConfig` and i18n builders.
- **Coordinates:** always relative to `getMapOrigin(schemaFrame, logs)`. Never use raw `absoluteBoundingBox` in output.
- **Slugs:** always `slugify(rawName)`. Never custom string-mangling.
- **Visibility:** filter hidden nodes (`visible !== false`) at every iteration level. Hidden nodes can have `absoluteBoundingBox = null` and break parsing. Use a local `isVisible(node)` helper or check inline.
- **Round numbers:** `round2(n)` for all numeric outputs (coordinates, dimensions).
- **Optional fields:** assign `undefined` for fields that should be omitted; `toJSObject` filters them out automatically. Don't conditionally spread.
- **Logging:** `info` for progress, `success` for parsed items (✓ ...), `warning` for non-fatal skips (⚠ ...), `error` only via the `errors[]` array. Russian language, matching existing tone.
- **Frame discovery:** check `selectedNode.name` first, then one level of children. Never deeper. Use `nameIncludes` (case/space/underscore-insensitive).
- **Name-keyword collisions:** when a container keyword (e.g. `pin`, `district`) also appears in viewport names (`Pins_Desktop`), explicitly exclude `mobile/mob/desktop/desk` in the container detector.

## Reusable utilities — don't duplicate

Before writing a helper, check if it exists:

- **`src/plugin/utils.ts`** — `slugify`, `round2`, `nameIncludes`, `normalizeName`, `isLanguageCode`, `getZoomLevel`, `getSvgName` (landmarks convention), `wrapExport`, `toJSObject`, `isSameLandmark` (fuzzy match), `levenshtein`.
- **`src/plugin/schemas/landmarks-common.ts`** — `getBBox`, `getChildNodes`, `getMapOrigin`, `findViewportFrames`, `isViewportFrameName`, `buildSvgConfig`.
- **`src/plugin/schemas/landmarks-detect.ts`** — `getLanguageFrames`, `getZoomFrames`, `findLabelFrame`, `findDirectAnchor`, `isLandmarkContainerCandidate`.

If you need something that already exists with a different name elsewhere, reuse it — don't make a parallel helper.

## Detector patterns by variant count

Pick the structure matching the new schema's dimensions:

| Schema needs | Mirror this detector | Variants |
|---|---|---|
| Only viewports | `streets-detect.ts` (simplified) | `viewports` only |
| Viewports + languages | `radius-detect.ts`, `streets-detect.ts` | 2 variants |
| Viewports + languages + zooms | `districts-detect.ts`, `landmarks-detect.ts` (v2) | 4 variants |
| Flat composite key (v2 style) | `pins.ts` `parseCompositeKey` + `isV2Structure` + `getPinLeavesV2` | — |

For v2 composite key support: only add if the user explicitly wants it OR the dump uses `"viewport|lang|zoom"` naming. The detection branch in `parsePins` is the template.

## Pairing & deduplication concerns

If the schema can have **multiple elements with the same text** in different positions (like `pins` does with multiple "Retail" pins), use the `pins.ts` pattern:

- Collector stores arrays (not Maps) — keep every leaf.
- Within each `(group, text, lang, zoom)` bucket, pair desktop↔mobile by **nearest icon-center position** (`pairLeavesByPosition`).
- The output `text` field can repeat — i18n dedupes by slug naturally.

If duplicates aren't expected (one element per identity), match by an explicit key like `slug` or `code|lang|zoom`.

## i18n / translations config

If the schema's elements have user-facing text that needs translation (like pins), produce a separate i18n config:

```js
// Bare object literal, slug → { lang: text }
{
    burj_khalifa: { en: "Burj Khalifa", ar: "..." },
    ...
}
```

Wire it via `result.i18nConfig` in the ParseResult. The UI already has a Translations tab that displays it. See `pins.ts` `I18nCollector` for the pattern. Text cleanup: `\r\n / \r → \n`, `\n → <br>`, collapse multi-spaces, trim.

## Color extraction (optional)

If the schema's elements have meaningful fill colors that the consumer needs (text color, background fill of labels), include `getSolidFillHex(node)` from `pins.ts` and emit `textColor` / `textBgColor` per group. Skip if colors are decorative or always identical.

## Verification

After all files are written:

1. **`npx tsc --noEmit`** — must pass cleanly. The repo's npm warnings (`msvs_version`, `node_gyp`) are unrelated; filter them out: `npx tsc --noEmit 2>&1 | grep -v "npm warn"`.
2. **Schema registry sanity check** — confirm the new entry shows up in `SCHEMAS[]` and the description is meaningful (it'll appear in the plugin UI under the schema selector).
3. **Output shape match** — eyeball the example file against the parser's `wrapExport(...)` argument. They should produce structurally identical objects.

Don't run the plugin — the user does that in Figma. But mention that they'll need to reload the plugin (Plugins → Development → Import from manifest again) after build.

## Stylistic conventions for generated code

- TypeScript with `/// <reference types="@figma/plugin-typings" />` at the top of plugin files.
- Russian-language docstrings/comments in `.ts` files where they match the rest of the codebase, but feel free to use English for inline implementation notes (most existing schemas mix both).
- 2-space indent in `.ts`, tabs in generated example `.js` files (matches existing examples).
- Logs in Russian (`"Выбран узел: ..."`, `"Парсинг завершён ✓"`).
- Documentation updates in Russian.

## Avoiding overthinking

For most new schemas, the work is mechanical:

1. Find the most similar existing schema (4-5 minutes reading SCHEMA_GUIDE.md Part 1).
2. Copy its `{name}.ts` and `{name}-detect.ts` as starting points.
3. Adjust field names, leaf extraction, and output shape to match the new schema's specifics.
4. Register, update docs, verify TS.

If you find yourself writing custom node-walking logic, stop and check whether `getLanguageFrames` / `getZoomFrames` / the v2 `parseCompositeKey` already cover it.

## When to push back

Some user requests don't map cleanly to a single schema:

- **"Parse all this stuff at once"** → suggest one schema per logical group, share helpers in `landmarks-common.ts` if appropriate.
- **"This schema needs config that's totally different from the others"** → still follow `ParseResult` contract; put schema-specific output under a unique top-level key, use `i18nConfig` for translations, use breakpoints for adaptive variants. Don't invent new ParseResult fields without coordinating with the user.
- **"Make it work without a dump"** → ask for one. Generating without seeing the actual node tree leads to wrong assumptions about layer names and structure.
