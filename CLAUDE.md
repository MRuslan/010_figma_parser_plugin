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
    code.ts                    — точка входа plugin sandbox (Figma API)
    types.ts                   — все shared типы (MessageToPlugin, MessageToUI, ParseResult, ...)
    utils.ts                   — slugify, normalizeName, getSvgName, getZoomLevel, isSameLandmark, toJSObject, wrapExport
    dev-dump.ts                — утилита дампа структуры узлов Figma в JSON (для отладки)
    schemas/
      index.ts                 — реестр схем (SCHEMAS[], getSchema, getSchemasInfo)
      landmarks-common.ts      — общие типы и хелперы для всех схем Landmarks
      landmarks-detect.ts      — авто-определение варианта структуры v2 (Viewports/Languages/Zooms)
      landmarks.ts             — парсер схемы Map Landmarks (v1, legacy)
      landmarks-v2.ts          — парсер схемы Map Landmarks v2 (Label + Anchor)
      projects-detect.ts       — авто-определение варианта структуры Projects
      projects.ts              — парсер схемы Map Projects (Zone + Label + Anchor)
      paths.ts                 — парсер схемы Map Paths (пути между проектами и лендмарками)
      radius-detect.ts         — авто-определение варианта структуры Radius (Viewports/Languages)
      radius.ts                — парсер схемы Map Radius (радиусы расстояний от проектов)
  ui/
    App.svelte                 — весь UI плагина
    main.ts                    — точка входа Vite
scripts/
  dev-setup.mjs               — пишет iframe-прокси в dist/ui.html
  build-plugin.mjs            — esbuild для plugin code (с ctx.rebuild() перед ctx.watch())
dist/                         — сборка (gitignore)
manifest.json                 — Figma plugin manifest
```

---

## Архитектура сообщений

**UI → Plugin (`MessageToPlugin`):**
- `GET_SELECTION` — запросить текущее выделение
- `GET_SCHEMAS` — запросить список схем
- `PARSE { schemaId }` — запустить парсинг
- `DOWNLOAD_SVGS { exports: SvgExportItem[] }` — экспортировать SVG из Figma
- `DUMP_STRUCTURE { options? }` — выгрузить дерево узлов выделения в JSON (dev-инструмент)
- `CLOSE` — закрыть плагин

**Plugin → UI (`MessageToUI`):**
- `SELECTION_DATA { data }` — инфо о выделенном узле
- `SCHEMAS_LIST { schemas }` — список схем
- `PARSE_PROGRESS { step, status }` — шаг лога (info/success/warning/error)
- `PARSE_RESULT { output, svgConfig, svgExports, errors }` — итог парсинга
- `SVG_EXPORT_PROGRESS { done, total, currentName }` — прогресс экспорта SVG
- `SVG_DATA { files: {name, data: number[]}[] }` — байты SVG для zip-архива
- `STRUCTURE_DUMP_RESULT { result, error }` — результат дампа структуры
- `ERROR { message }` — критическая ошибка

---

## ParseResult (из schemas)

```typescript
interface ParseResult {
  output: string | null;                // JS-конфиг (wrapExport)
  svgConfig: string | null;            // SVG paths конфиг
  svgExports: SvgExportItem[] | null;  // [{name, nodeId}] для экспорта
  logs: LogEntry[];
  errors: string[];
}
```

---

## Реестр схем

В `src/plugin/schemas/index.ts` зарегистрированы две схемы:

| id | name | файл |
|---|---|---|
| `landmarks` | Map Landmarks | `landmarks.ts` (v1, legacy) |
| `landmarks-v2` | Map Landmarks v2 | `landmarks-v2.ts` |

---

## Схема: Map Landmarks v2 (актуальная)

**Файл:** `src/plugin/schemas/landmarks-v2.ts`  
**ID:** `landmarks-v2`  
**Выход:** `export default { map_landmarks: { mobile_landmarks: [...], desktop_landmarks: [...] } }`

### Структура Figma:
```
[Любой узел]
└── Landmarks
    ├── Mobile
    │   ├── [en] (опционально, язык ISO 2-3 chars)
    │   │   ├── [Zoom 1] (опционально)
    │   │   │   └── [Landmark Name]
    │   │   │       ├── Label (FRAME/INSTANCE — bubble)
    │   │   │       └── Anchor (ELLIPSE, опционально)
    │   │   └── [Zoom 2] ...
    │   └── [ar] ...
    └── Desktop
        └── ...
```

### Варианты структуры (авто-определяются через `detectV2Structure`):
- `viewports` — только Mobile/Desktop
- `viewports+languages` — + языковые слои
- `viewports+zooms` — + зум-слои
- `viewports+languages+zooms` — полная структура

### Ключевые отличия v2 от v1:
- Bubble — фрейм/инстанс с именем `Label` (не любой Instance внутри layout)
- Anchor — прямой дочерний Ellipse с именем `Anchor` (не внутри Line фрейма)
- Zoom хранится как поле `zoom: N` на элементе (не вычисляемые `minZoom`/`maxZoom`)
- `isLandmarkContainerCandidate()` фильтрует служебные слои (viewport/language/zoom/line)

### LandmarkItem (общий тип из `landmarks-common.ts`):
```typescript
interface LandmarkItem {
  id: string;
  type: 'v2';
  code: string;           // slugify(name)
  anchor: { left, top, width, height };
  bubble: { left?, top?, width, height, svg };
  language: string[];
  zoom?: number;          // v2: исходный уровень зума (1, 2, ...)
  minZoom?: number;       // v1 legacy
  maxZoom?: number;       // v1 legacy
}
```

### SVG именование (общее для v1 и v2):
```
en  + mobile  → {code}_mob
en  + desktop → {code}
ar  + mobile  → {code}_ar_mob
ar  + desktop → {code}_ar
```

### Элемент без Anchor:
- `anchor = { left, top, width, height }` от Label
- `bubble = { width, height, svg }` (без `left`/`top`)

---

## Схема: Map Landmarks v1 (legacy)

**Файл:** `src/plugin/schemas/landmarks.ts`  
**ID:** `landmarks`

Использует Line-фрейм + Ellipse как якорь, любой Instance внутри layout как bubble.  
Zoom-логика: `applyZoomLogic()` вычисляет `minZoom`/`maxZoom` между группами, fuzzy-сравнение через Levenshtein.

---

## Shared helpers

### `src/plugin/schemas/landmarks-common.ts`
Общие типы и функции для обеих схем:
- `LandmarkItem`, `LandmarkAnchor`, `LandmarkBubble`, `LandmarksConfig`
- `findLandmarksFrame(node, logs)` — ищет Landmarks-фрейм в выделении или его детях
- `getMapOrigin(frame, logs)` — origin координат карты из родительского фрейма
- `findViewportFrames(frame)` → `{ mobile, desktop }`
- `buildLandmarksResult(mobile[], desktop[], logs, errors)` → `ParseResult`
- `getChildNodes`, `getBBox`, `isViewportFrameName`

### `src/plugin/schemas/landmarks-detect.ts`
Авто-определение варианта v2:
- `detectV2Structure(frame)` → `{ flags, variant, variantLabel }`
- `getLanguageFrames(parent)`, `getZoomFrames(parent)`
- `isLandmarkContainerCandidate(node)` — исключает служебные слои
- `findLabelFrame(landmark)` — ищет дочерний фрейм с именем "label"
- `findDirectAnchor(landmark)` — ищет Ellipse с именем "anchor"

### `src/plugin/utils.ts`
- `slugify`, `normalizeName`, `nameIncludes`
- `isLanguageCode`, `getSvgName`
- `getZoomLevel`, `levenshtein`, `isSameLandmark`
- `toJSObject`, `wrapExport`

---

## Dev: Structure Dump

В UI есть секция **Developer** (сворачиваемая) для дампа дерева узлов Figma в JSON.

Параметры: глубина (1–99 или без лимита), включать скрытые, включать bbox.  
Результат: `StructureDumpResult { root: StructureDumpNode, meta }` — можно скопировать или скачать как `.json`.

Используется для разработки новых схем: передаём дамп в чат с AI, чтобы описать структуру.

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

- **Секция выделения:** показывает тип и имя выделенного узла
- **Секция схем:** кнопки-переключатели по зарегистрированным схемам + описание
- **Секция лога:** max-height 200px, overflow scroll, auto-scroll вниз через `afterUpdate`
- **Developer секция:** сворачиваемый блок дампа структуры (опции + кнопка + JSON-вывод)
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
- `isLandmarkContainerCandidate` важен в v2: без него зум/язык/viewport фреймы трактуются как лендмарки

---

## Реестр схем

| id | name | файл |
|---|---|---|
| `landmarks` | Map Landmarks | `landmarks.ts` (v1, legacy) |
| `landmarks-v2` | Map Landmarks v2 | `landmarks-v2.ts` |
| `projects` | Map Projects | `projects.ts` |
| `paths` | Map Paths | `paths.ts` |
| `radius` | Map Radius | `radius.ts` |

Подробное описание всех схем и правила создания новых — **`SCHEMA_GUIDE.md`** в корне проекта.

---

## Что планируется дальше

- Новые схемы парсинга (пользователь добавит по мере разработки)
- SVG download протестирован, работает через `getNodeByIdAsync`
