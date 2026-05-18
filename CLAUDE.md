# Figma Parser — Project Brief

## Что это

Плагин для Figma, который парсит выделенные элементы карты в конфиг-файлы JS.

**Стек:**
- Frontend: Svelte 4 + Vite + TypeScript (`src/ui/`)
- Plugin sandbox: TypeScript + esbuild (`src/plugin/`)
- Dev HMR: iframe-прокси в `dist/ui.html` → `localhost:5173`

---

## Запуск

```bash
npm install        # нужно после добавления jszip
npm run dev        # Vite dev server + esbuild watch + proxy в dist/ui.html
npm run build      # production build → dist/
```

В Figma: **Plugins → Development → Import plugin from manifest** → выбрать `manifest.json`.

---

## Структура файлов

```
src/
  plugin/
    code.ts          — точка входа plugin sandbox (Figma API)
    types.ts         — все shared типы (MessageToPlugin, MessageToUI, ParseResult, ...)
    utils.ts         — slugify, normalizeName, getSvgName, getZoomLevel, isSameLandmark, toJSObject, wrapExport
    schemas/
      index.ts       — реестр схем (SCHEMAS[], getSchema, getSchemasInfo)
      landmarks.ts   — парсер схемы Map Landmarks
  ui/
    App.svelte       — весь UI плагина
    main.ts          — точка входа Vite
scripts/
  dev-setup.mjs     — пишет iframe-прокси в dist/ui.html
  build-plugin.mjs  — esbuild для plugin code (с ctx.rebuild() перед ctx.watch())
dist/               — сборка (gitignore)
examples/
  landmarks.js      — пример ожидаемого выходного конфига
manifest.json       — Figma plugin manifest
```

---

## Архитектура сообщений

**UI → Plugin (`MessageToPlugin`):**
- `GET_SELECTION` — запросить текущее выделение
- `GET_SCHEMAS` — запросить список схем
- `PARSE { schemaId }` — запустить парсинг
- `DOWNLOAD_SVGS { exports: SvgExportItem[] }` — экспортировать SVG из Figma
- `CLOSE` — закрыть плагин

**Plugin → UI (`MessageToUI`):**
- `SELECTION_DATA { data }` — инфо о выделенном узле
- `SCHEMAS_LIST { schemas }` — список схем
- `PARSE_PROGRESS { step, status }` — шаг лога (info/success/warning/error)
- `PARSE_RESULT { output, svgConfig, svgExports, errors }` — итог парсинга
- `SVG_EXPORT_PROGRESS { done, total, currentName }` — прогресс экспорта SVG
- `SVG_DATA { files: {name, data: number[]}[] }` — байты SVG для zip-архива

---

## ParseResult (из schemas)

```typescript
interface ParseResult {
  output: string | null;       // JS-конфиг (wrapExport)
  svgConfig: string | null;    // SVG paths конфиг
  svgExports: SvgExportItem[] | null; // [{name, nodeId}] для экспорта
  logs: LogEntry[];
  errors: string[];
}
```

---

## Схема: Map Landmarks

**Файл:** `src/plugin/schemas/landmarks.ts`  
**ID:** `landmarks`  
**Выход:** `export default { map_landmarks: { mobile_landmarks: [...], desktop_landmarks: [...] } }`

### Структура Figma (ожидаемая):
```
[Любой узел]
└── Landmarks (или родитель → ищем вложенный)
    ├── Mobile (или Landmarks_Mobile)
    │   ├── [en] (опционально, язык)
    │   │   ├── [Zoom 1] (опционально, зум)
    │   │   │   └── [Landmark Name]
    │   │   │       └── [Layout: Left Bottom / Center Top / ...]
    │   │   │           ├── Line (FRAME) → Ellipse (якорь)
    │   │   │           └── Instance (bubble)
    │   │   └── [Zoom 2] ...
    │   └── [ar] (опционально)
    └── Desktop (или Landmarks_Desktop)
        └── ... (аналогично)
```

### Правила именования:
- Имена фреймов нормализуются: пробелы и `_` → пробел (для поиска ключевых слов)
- `mobile`/`mob` → мобильный вьюпорт; `desktop`/`desk` → десктоп
- Языковые фреймы: 2–3 буквы ISO (`en`, `ar`, `ru`, ...)
- Зум-фреймы: `Zoom 1`, `zoom_2`, `Zoom  3` → уровень N

### SVG именование:
```
en  + mobile  → {code}_mob
en  + desktop → {code}
ar  + mobile  → {code}_ar_mob
ar  + desktop → {code}_ar
```

### Координаты:
- Берём `absoluteBoundingBox` родительского фрейма (карты) как origin
- Все координаты = canvas position − origin

### Zoom логика (applyZoomLogic):
- Zoom 1: нет `minZoom`; `maxZoom: 1.99` если нет в Zoom 2
- Zoom N (N > 1): `minZoom: N`; `maxZoom: N.99` если нет в следующем
- Последний уровень: только `minZoom`, без `maxZoom`
- Сравнение между уровнями: fuzzy через Levenshtein (порог 20% от длины, min 2)

### Элемент без Ellipse:
- Bubble IS якорь → `anchor = { left, top, width, height }` от bubble
- `bubble = { width, height, svg }` (без `left`/`top`)

---

## SVG Export (Download SVG)

1. UI → Plugin: `DOWNLOAD_SVGS { exports }` (массив `{name, nodeId}`)
2. Plugin: `await figma.getNodeByIdAsync(nodeId)` → `exportAsync({ format: 'SVG' })`
3. Plugin → UI: `SVG_EXPORT_PROGRESS` после каждого файла
4. Plugin → UI: `SVG_DATA { files }` после всех
5. UI: JSZip пакует → скачивает `landmarks-svg.zip`

**Важно:** использовать `figma.getNodeByIdAsync` (не `getNodeById`) — Figma требует async версию при `documentAccess: dynamic-page`.

---

## UI (App.svelte)

- **Секция лога:** max-height 200px, overflow scroll, auto-scroll вниз через `afterUpdate`
- **Результат:** 2 таба — Config / SVG Config
  - Config: `Copy Config` + `<pre>` с output
  - SVG Config: `Copy SVG Config` + `↓ Download SVG` + прогресс-бар экспорта + `<pre>` с svgConfig
- **Прогресс-бар SVG:** 2 фазы: Экспорт (X/total) + Упаковка (%)

---

## Известные нюансы

- `vitePreprocess()` нужен в `vite.config.ts` для `<script lang="ts">` в Svelte
- `ctx.rebuild()` перед `ctx.watch()` в `build-plugin.mjs` — иначе нет первичной сборки
- `jszip` — зависимость в `dependencies` (не devDependencies), нужен `npm install`
- `SchemaInfo` живёт только в `types.ts`; `index.ts` импортирует его оттуда

---

## Что планируется дальше

- Новые схемы парсинга (пользователь добавит по мере разработки)
- SVG download протестирован, работает через `getNodeByIdAsync`
