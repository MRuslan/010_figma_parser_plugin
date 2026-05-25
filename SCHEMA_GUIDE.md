# Figma Parser — Руководство по схемам парсинга

Этот файл описывает все существующие схемы и содержит правила создания новых.
Аудитория: разработчик или AI-агент, которому нужно добавить новую схему.

---

## Часть 1 — Существующие схемы

### Схема 1: Map Landmarks v1

**ID:** `landmarks` | **Файл:** `src/plugin/schemas/landmarks.ts`  
**Выход:** `export default { map_landmarks: { mobile_landmarks: [...], desktop_landmarks: [...] } }`

#### Структура Figma:
```
[Landmarks]
└── Mobile / Desktop
    └── [lang: "en" / "ar"] ?
        └── [Zoom N] ?
            └── [Landmark Name]       ← контейнер
                └── layout-frame      ← первый дочерний фрейм ("Left Bottom" и др.)
                    ├── INSTANCE      ← bubble (картинка)
                    └── FRAME "line"
                        └── ELLIPSE   ← anchor dot
```

#### Особенности:
- Bubble = первый `INSTANCE` в layout-фрейме
- Anchor = `ELLIPSE` внутри `FRAME` с "line" в имени (внутри layout-фрейма)
- Если нет Line-фрейма → bubble IS anchor (без отдельных координат)
- **Zoom-логика:** `applyZoomLogic()` вычисляет `minZoom`/`maxZoom` между зум-группами через нечёткое сравнение (Levenshtein). Лендмарк пропадает на следующем зуме → получает `maxZoom: N.99`
- SVG-имена: `en` = дефолт (без суффикса), `ar` → `_ar`

---

### Схема 2: Map Landmarks v2

**ID:** `landmarks-v2` | **Файлы:** `src/plugin/schemas/landmarks-v2.ts`, `landmarks-detect.ts`  
**Выход:** `export default { map_landmarks: { mobile_landmarks: [...], desktop_landmarks: [...] } }`

#### Структура Figma (4 авто-определяемых варианта):
```
[Landmarks]
└── Mobile / Desktop
    └── [lang] ?         ← GROUP с ISO-кодом (en, ar, …)
        └── [zoom_N] ?   ← GROUP/FRAME "zoom_1", "Zoom 2", …
            └── [Landmark Name]    ← контейнер лендмарка
                ├── FRAME/INSTANCE "Label"   ← bubble
                └── ELLIPSE "Anchor"         ← anchor dot (прямой дочерний)
```

#### Варианты (авто-определяет `detectV2Structure`):
| Вариант | Флаги |
|---|---|
| `viewports` | только Mobile/Desktop |
| `viewports+languages` | + языковые слои |
| `viewports+zooms` | + зум-слои |
| `viewports+languages+zooms` | полная структура |

#### Ключевые отличия от v1:
- Label — `FRAME`/`INSTANCE` с именем "label" (прямой дочерний контейнера)
- Anchor — `ELLIPSE` с именем "anchor" (прямой дочерний контейнера, НЕ внутри Line)
- Zoom хранится как `zoom: N` на элементе (не `minZoom`/`maxZoom`)
- `isLandmarkContainerCandidate()` фильтрует служебные слои (viewport / language / zoom / line-frame)
- SVG-имена: `en` = дефолт (без суффикса), `ar` → `_ar`

---

### Схема 3: Map Projects

**ID:** `projects` | **Файлы:** `src/plugin/schemas/projects.ts`, `projects-detect.ts`  
**Выход:** `export default { projects: [...] }`

#### Структура Figma:
```
[Projects]
└── [project_code]             ← GROUP, имя = code проекта
    ├── Project_Zone           ← FRAME с зоной (polygon shape)
    │   └── VECTOR
    ├── Project_Mobile         ← FRAME, мобильный viewport
    │   └── [lang] ?
    │       └── [zoom_N] ?
    │           ├── VECTOR     ← connector (игнорируется)
    │           ├── FRAME "Label"
    │           └── ELLIPSE "Anchor"
    └── Project_Desktop        ← GROUP/FRAME, десктопный viewport
        └── [lang] ?
            └── [zoom_N] ?
                ├── VECTOR
                ├── FRAME "Label"
                └── ELLIPSE "Anchor"
```

#### Два типа записей в выходном массиве:
```js
// 1. Zone — один на проект
{ type: "zone", code, state, clickable: true, left, top, width, height, svg: "{code}_zone" }

// 2. V2 — один на комбинацию (lang × zoom), Mobile и Desktop сливаются
{
  type: "v2", code, state, clickable: true,
  zoom?: N,           // если есть зум-слои
  language?: ["en"],  // если есть языковые слои
  anchor: { left, top, width, height },      // из Desktop (fallback Mobile)
  body: { left, top, width, height, svg, scale: true },            // Desktop Label
  breakpoints: { 768: { body: { ..., svg, scale: true } } }        // Mobile Label
}
```

#### SVG-имена (Projects):
- Без языков: `{code}_button` / `{code}_button_mob`
- С языками: `{code}_button_{lang}` / `{code}_button_{lang}_mob` — **суффикс всегда, даже для `en`**
- Zone: `{code}_zone`

#### Варианты структуры — те же 4, что у v2 (авто-определяет `detectProjectsStructure`)

---

### Схема 4: Map Paths

**ID:** `paths` | **Файл:** `src/plugin/schemas/paths.ts`  
**Выход:** `export default { paths: [...] }`

#### Структура Figma:
```
[Paths]
└── [from_project]        ← GROUP, имя = проект-источник
    └── [to_landmark]     ← FRAME, имя = лендмарк-назначение
        └── VECTOR        ← геометрия пути (SVG)
```

#### Выходной объект:
```js
{
    code: "dubai",          // slugify(FRAME.name) == to
    svg: "dubai_path",      // "{code}_path"
    from: "sobha_city",     // slugify(GROUP.name)
    to: "dubai",            // slugify(FRAME.name) == code
    left: 910,              // FRAME bbox.x - originX
    top: 1272,              // FRAME bbox.y - originY
    width: 81,              // FRAME bbox.width
    height: 29,             // FRAME bbox.height
}
```

#### Особенности:
- Нет Viewports / Languages / Zooms — структура всегда фиксирована (2 уровня)
- `code` = `to` — одно и то же значение (slugify имени FRAME)
- SVG-имя: `{code}_path`
- SVG config path: `./svg/map/[name_map]/paths/{name}`
- Файл детектора (`paths-detect.ts`) не нужен — нет вариантов структуры

---

### Схема 5: Map Radius

**ID:** `radius` | **Файлы:** `src/plugin/schemas/radius.ts`, `radius-detect.ts`  
**Выход:** `export default { radius: [...] }`

#### Структура Figma:
```
[Radius]
└── [project_code]          ← GROUP, имя = code проекта
    ├── Mobile              ← viewport
    │   └── [lang] ?        ← GROUP с ISO-кодом (en, ar, …)
    │       └── GROUP/BOOLEAN_OP "Radius"   ← SVG элемент радиуса (с km-метками)
    └── Desktop             ← viewport
        └── [lang] ?
            └── BOOLEAN_OP "Radius"         ← SVG элемент радиуса
```

#### Выходной объект (один на комбинацию project × lang):
```js
{
    code: "sobha_city",       // slugify(проект)
    language: ["en"],         // только если есть языковые слои
    left: 910,                // Desktop RADIUS bbox.x - originX
    top: 1272,                // Desktop RADIUS bbox.y - originY
    width: 81,                // Desktop RADIUS bbox.width
    height: 29,               // Desktop RADIUS bbox.height
    svg: "sobha_city_radius_en",
    breakpoints: {
        768: {
            left: ...,        // Mobile RADIUS bbox
            top: ...,
            width: ...,
            height: ...,
            svg: "sobha_city_radius_en_mob",
        }
    }
}
```

#### SVG-имена (Radius):
- Без языков: `{code}_radius` / `{code}_radius_mob`
- С языками: `{code}_radius_{lang}` / `{code}_radius_{lang}_mob` — **суффикс всегда, даже для `en`**

#### Особенности:
- Нет зум-слоёв — Radius не зависит от уровня масштаба карты
- Нет отдельного Anchor / Body — радиус сам по себе является SVG-элементом с координатами
- Km-метки и центральная точка (ELLIPSE) — часть SVG, не берём как данные
- `findRadiusNode(container)` — ищет первого дочернего с "radius" в имени (обрабатывает оба варианта: GROUP на мобайле и BOOLEAN_OP на десктопе)
- SVG config folder: `radius`

#### Варианты структуры (авто-определяет `detectRadiusStructure`):
| Вариант | Флаги |
|---|---|
| `viewports` | только Mobile/Desktop |
| `viewports+languages` | + языковые слои |

---

## Часть 2 — Правила создания новых схем

### Правило 1: Файловая структура

**Сложная схема** (есть Viewports / Languages / Zooms) — два файла:

| Файл | Назначение |
|---|---|
| `src/plugin/schemas/{name}-detect.ts` | Только детектор структуры |
| `src/plugin/schemas/{name}.ts` | Парсер + типы + точка входа |

**Простая схема** (структура фиксирована, нет вариантов) — один файл:

| Файл | Назначение |
|---|---|
| `src/plugin/schemas/{name}.ts` | Парсер + типы + точка входа |

Примеры: `paths.ts` — только один файл, `projects.ts` + `projects-detect.ts` — два.

Регистрация в `src/plugin/schemas/index.ts`:
```ts
import { parse{Name} } from './{name}';

// В SCHEMAS[]:
{
  id: '{name}',
  name: 'Human Readable Name',
  description: 'Краткое описание схемы',
  parse: parse{Name},
},
```

После — обновить `CLAUDE.md`: таблицу схем и описание структуры.

---

### Правило 2: Детектор структуры (`{name}-detect.ts`)

Минимальный шаблон:

```ts
export interface {Name}StructureFlags {
  viewports: boolean;
  languages: boolean;
  zooms: boolean;
  // + специфичные флаги при необходимости
}

export type {Name}Variant =
  | 'viewports'
  | 'viewports+languages'
  | 'viewports+zooms'
  | 'viewports+languages+zooms'
  | 'unknown';

export interface {Name}StructureProfile {
  flags: {Name}StructureFlags;
  variant: {Name}Variant;
  variantLabel: string;
}

export function detect{Name}Structure(frame: SceneNode): {Name}StructureProfile {
  // 1. Найти образцовый контейнер (первый проект, первый viewport, ...)
  // 2. Определить флаги languages и zooms из образца
  // 3. Вернуть profile
}
```

Детектор **не должен парсить** — только определять флаги.

---

### Правило 3: Нахождение корневого фрейма

```ts
function find{Name}Frame(selectedNode: SceneNode, logs: LogEntry[]): SceneNode | null {
  // 1. Проверить сам selectedNode
  if (isTargetName(selectedNode.name)) {
    logs.push({ step: `Выбран узел: "${selectedNode.name.trim()}"`, status: 'info' });
    return selectedNode;
  }
  // 2. Поиск на 1 уровень глубже (пользователь мог выбрать родительский фрейм)
  if ('children' in selectedNode) {
    for (const child of getChildNodes(selectedNode)) {
      if (isTargetName(child.name)) {
        logs.push({ step: `Найден вложенный узел: "${child.name.trim()}"`, status: 'info' });
        return child;
      }
    }
  }
  return null;
}
```

**Правила матчинга имён:**
- Используй `nameIncludes(name, 'keyword')` — нечувствителен к регистру, пробелам и `_`
- Исключай служебные слои явно: если ключевое слово совпадает и с viewport, и с контейнером — добавь отрицательные условия
- НЕ ищи глубже 1 уровня

---

### Правило 4: Координаты — всегда через `getMapOrigin`

```ts
const { originX, originY } = getMapOrigin(schemaFrame, logs);
// Далее:
left: round2(bbox.x - originX),
top:  round2(bbox.y - originY),
```

`getMapOrigin` берёт `absoluteBoundingBox` у **родителя** переданного фрейма.  
Родитель должен быть фреймом карты (не PAGE). Если родителя нет — логирует предупреждение, координаты будут canvas-абсолютными.

---

### Правило 5: Листовые данные (leaf extraction)

Паттерн "листа" — узел, который содержит конечные данные (Label, Anchor, координаты).  
Универсальный подход через внутренний тип:

```ts
interface {Name}Leaf {
  language: string;  // 'en' если языков нет
  zoom: number;      // 0 если зумов нет
  labelNode: SceneNode;
  anchorNode: EllipseNode | null;
  // + специфичные поля
}

function getViewportLeaves(viewport: SceneNode, flags: StructureFlags): {Name}Leaf[] {
  // Матрица вариантов:
  if (flags.languages && flags.zooms) { /* lang → zoom → extract */ }
  if (flags.languages)                { /* lang → extract */ }
  if (flags.zooms)                    { /* zoom → extract, lang='en' */ }
  /* else */                          { /* extract directly, lang='en', zoom=0 */ }
}
```

Ключ для Map при слиянии: `\`${leaf.language}:${leaf.zoom}\``

---

### Правило 6: SVG-экспорты

```ts
const svgExports: SvgExportItem[] = [];

// Во время парсинга накапливать:
svgExports.push({ name: svgName, nodeId: labelOrFrameNode.id });

// В result builder — дедупликация:
const seen = new Set<string>();
const uniqueExports = svgExports.filter(({ name }) => {
  if (seen.has(name)) return false;
  seen.add(name);
  return true;
});
```

**SVG config path** (конвенция): `"./svg/map/[name_map]/{schema-folder}/{name}"`  
Примеры: `./svg/map/[name_map]/landmarks/{name}`, `./svg/map/[name_map]/projects/{name}`

---

### Правило 7: SVG-именование

| Контекст | Паттерн | Примеры |
|---|---|---|
| Landmarks (en = дефолт) | `{code}[_{lang}][_mob]` | `burj_khalifa`, `burj_khalifa_ar`, `burj_khalifa_mob`, `burj_khalifa_ar_mob` |
| Projects body (всегда явный lang) | `{code}_button[_{lang}][_mob]` | `city_button`, `city_button_ar`, `city_button_mob`, `city_button_ar_mob` |
| Projects zone | `{code}_zone` | `city_zone` |
| Новая схема | определить и задокументировать | — |

**Функция `getSvgName(code, language, isMobile)`** из `utils.ts` реализует Landmarks-конвенцию (en без суффикса). Для схем с другой конвенцией — писать отдельную функцию.

---

### Правило 8: Выходной формат

```ts
// Всегда оборачивать через wrapExport:
const output = wrapExport('export_key', configObject);
// → `export default {\n\texport_key: ...,\n};\n`

// toJSObject поведение (используется внутри wrapExport):
// - ключи без кавычек
// - табы для отступов
// - trailing commas
// - undefined значения ФИЛЬТРУЮТСЯ → используй для опциональных полей
```

Для опциональных полей в выходных объектах:
```ts
const item = {
  requiredField: value,
  optionalField: condition ? value : undefined,  // undefined → отфильтруется из вывода
  anotherField: value,
};
```

---

### Правило 9: Логирование

```ts
logs.push({ step: 'текст', status: 'info' | 'success' | 'warning' | 'error' });
```

| Статус | Когда использовать |
|---|---|
| `info` | Прогресс: нашли фрейм, определили вариант, начинаем viewport |
| `success` | Элемент успешно распарсен (`✓ {name} → "{code}"`) |
| `warning` | Пропущен не-фатально: нет Label, нет Anchor, неожиданный дочерний |
| `error` | Критическая проблема (кладём в `errors[]`, не в `logs`) |

---

### Правило 10: Переиспользуемые утилиты

**`src/plugin/utils.ts`**
- `slugify(name)` — имя слоя → snake_case код
- `round2(n)` — округление до 2 знаков
- `nameIncludes(name, word)` — case/space/underscore-insensitive поиск
- `normalizeName(name)` — trim + lowercase + `[\s_]+` → пробел
- `isLanguageCode(name)` — `/^[a-z]{2,3}$/` (en, ar, ru, …)
- `getZoomLevel(name)` — "zoom_2" → 2, иначе null
- `getSvgName(code, lang, isMobile)` — Landmarks-конвенция SVG
- `wrapExport(key, value)` — оборачивает в `export default { ... }`
- `toJSObject(value)` — JS-форматирование объекта
- `isSameLandmark(code1, code2)` — нечёткое сравнение через Levenshtein (только для v1 zoom-логики)

**`src/plugin/schemas/landmarks-common.ts`**
- `getBBox(node)` — `absoluteBoundingBox ?? null`
- `getChildNodes(node)` — безопасное получение детей (пустой массив если нет)
- `getMapOrigin(frame, logs)` → `{ originX, originY }`
- `findViewportFrames(frame)` → `{ mobile, desktop }` (поиск по "mobile"/"desktop")
- `isViewportFrameName(name)` — true если mobile/mob/desktop/desk

**`src/plugin/schemas/landmarks-detect.ts`**
- `getLanguageFrames(parent)` — все дочерние с ISO-кодом имени
- `getZoomFrames(parent)` — все дочерние с zoom_N именем, сортированные по уровню
- `findLabelFrame(container)` — прямой дочерний с "label" в имени
- `findDirectAnchor(container)` — прямой дочерний ELLIPSE с "anchor" в имени
- `isLandmarkContainerCandidate(node)` — исключает viewport/lang/zoom/line слои

---

### Правило 11: Чеклист перед финальным PR

- [ ] TypeScript: `npx tsc --noEmit` — ноль ошибок
- [ ] Зарегистрировано в `src/plugin/schemas/index.ts`
- [ ] Обновлён `CLAUDE.md`: таблица схем + описание структуры
- [ ] Файл дампа добавлен в `examples/dumps/`
- [ ] Пример выходного файла в `examples/`

---

## Быстрый старт для новой схемы

```
1. examples/dumps/{name}-*.json         — добавить дамп для разработки
2. examples/{name}.js                   — добавить пример ожидаемого вывода
3. src/plugin/schemas/{name}-detect.ts  — детектор структуры
4. src/plugin/schemas/{name}.ts         — парсер
5. src/plugin/schemas/index.ts          — регистрация
6. CLAUDE.md                            — документация структуры
7. SCHEMA_GUIDE.md                      — раздел в Части 1
```
