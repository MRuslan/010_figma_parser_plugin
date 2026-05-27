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

### Схема 6: Map Streets

**ID:** `streets` | **Файлы:** `src/plugin/schemas/streets.ts`, `streets-detect.ts`  
**Выход:** `export default { streets: [...] }`

#### Структура Figma:
```
[Streets]
├── Streets_Desktop             ← viewport (nameIncludes 'desktop')
│   └── [lang] ?                ← GROUP с ISO-кодом (en, ar, …)
│       └── [Street Name]       ← FRAME — SVG-элемент улицы
│           └── VECTOR
└── Streets_Mobile              ← viewport (nameIncludes 'mobile')
    └── [lang] ?
        └── [Street Name]       ← FRAME — SVG-элемент улицы
            └── VECTOR
```

#### Выходной объект (один на комбинацию street × lang):
```js
{
    language: ["en"],                                  // только если есть языковые слои
    svg: "sheikh_maktoum_bin_rashid_road_street_en",   // Desktop SVG
    left: 1372,                                        // Desktop bbox.x - originX
    top: 1244,                                         // Desktop bbox.y - originY
    width: 96,
    height: 180,
    breakpoints: {
        768: {
            left: 1353,                                // Mobile bbox
            top: 1207,
            width: 132,
            height: 248,
            svg: "sheikh_maktoum_bin_rashid_road_street_mob_en",
        }
    }
}
```

#### SVG-имена (Streets):
- Без языков: `{code}_street` / `{code}_street_mob`
- С языками: `{code}_street_{lang}` / `{code}_street_mob_{lang}` — **суффикс всегда, даже для `en`**

#### Порядок элементов в выводе:
- Для каждого `code` (в порядке desktop → mobile): для каждого `lang` (в порядке lang-групп desktop)
- Итог: `street1_en`, `street1_ar`, `street2_en`, `street2_ar`, …

#### Особенности:
- Нет зум-слоёв — улицы не зависят от уровня масштаба
- Нет отдельного Anchor — FRAME улицы сам является SVG-элементом с координатами
- Весь FRAME (включая VECTOR внутри) экспортируется как один SVG
- `isStreetsContainerName(name)`: включает "street", исключает "mobile"/"mob"/"desktop"/"desk"
- SVG config folder: `streets`

#### Варианты структуры (авто-определяет `detectStreetsStructure`):
| Вариант | Флаги |
|---|---|
| `viewports` | только Mobile/Desktop |
| `viewports+languages` | + языковые слои |

---

### Схема 7: Map Districts

**ID:** `districts` | **Файлы:** `src/plugin/schemas/districts.ts`, `districts-detect.ts`  
**Выход:** `export default { districts: [...] }`

#### Структура Figma (4 авто-определяемых варианта):
```
[Districts]
├── Districts_Desktop          ← viewport (nameIncludes 'desktop')
│   └── [lang] ?               ← GROUP с ISO-кодом (en, ar, …)
│       └── [Zoom N] ?         ← GROUP/FRAME "zoom_1", "Zoom 2", …
│           └── [District Name]  ← FRAME — SVG-элемент района (зона + текст)
│               ├── VECTOR     ← контур зоны
│               └── TEXT       ← название района
└── Districts_Mobile           ← viewport (nameIncludes 'mobile')
    └── ...
```

#### Выходной объект (один на комбинацию district × lang × zoom):
```js
{
    language: ["en"],                    // только если есть языковые слои
    zoom: 1,                             // только если есть зум-слои (raw level)
    svg: "yas_island_district_zoom_1",   // Desktop SVG
    left: 1161,                          // Desktop bbox.x - originX
    top: 800.5,
    width: 205,
    height: 236.5,
    breakpoints: {
        768: {
            left: ...,                   // Mobile bbox
            top: ...,
            width: ...,
            height: ...,
            svg: "yas_island_district_mob_zoom_1",
        }
    }
}
```

#### SVG-имена (Districts):
- `{code}_district[_mob][_{lang}][_zoom_{N}]`
- Без языков, без zoom: `{code}_district` / `{code}_district_mob`
- С языком en, без zoom: `{code}_district_en` / `{code}_district_mob_en`
- С языком en, zoom 1: `{code}_district_en_zoom_1` / `{code}_district_mob_en_zoom_1`

#### Порядок элементов в выводе:
- Для каждого `code` → для каждого `lang` → для каждого `zoom`
- `code` в порядке desktop → mobile; `lang` в порядке lang-групп desktop; `zoom` в порядке zoom-фреймов desktop

#### Особенности:
- Весь FRAME района (с VECTOR + TEXT внутри) экспортируется как один SVG
- `isDistrictsContainerName(name)`: включает "district", исключает "mobile"/"mob"/"desktop"/"desk"
- Zoom детектируется рекурсивно: прямой дочерний viewport ИЛИ дочерний language-группы
- Переиспользует `getLanguageFrames`, `getZoomFrames` из `landmarks-detect.ts`
- SVG config folder: `districts`

#### Варианты структуры (авто-определяет `detectDistrictsStructure`):
| Вариант | Флаги |
|---|---|
| `viewports` | только Mobile/Desktop — **дамп в `examples/dumps/districts.json`** |
| `viewports+languages` | + языковые слои |
| `viewports+zooms` | + зум-слои |
| `viewports+languages+zooms` | полная структура |

---

### Схема 8: Map Pins

**ID:** `pins` | **Файлы:** `src/plugin/schemas/pins.ts`, `pins-detect.ts`
**Выход:** `export default { map_pins: { map_<group>: { ... }, ... } }`

Пины — интерактивные кружочки на карте с появляющейся подписью при наведении.
Делятся на **группы** по категории (`Education`, `Health`, `Mosque`, `Retail`, …),
каждая группа имеет свою SVG-иконку и размер кружочка; внутри группы — массив пинов
с уникальной позицией, подписью и направлением подписи (`isRight`).

#### Структура Figma (4 авто-определяемых варианта):
```
[Pins / Pins_Hover / …]            ← root (nameIncludes 'pin', НЕ viewport)
├── Pins_Desktop                    ← viewport (nameIncludes 'desktop')
│   └── [lang] ?                    ← GROUP с ISO-кодом (en, ar, …)
│       └── [Zoom N] ?              ← GROUP/FRAME "zoom_1", "Zoom 2", …
│           ├── Education           ← группа пинов (любое имя; slug → 'map_education')
│           │   ├── Pins            ← пин-фрейм
│           │   │   ├── Icon        ← FRAME содержит "icon" (кружочек + svg)
│           │   │   └── Name L/R/Hover/…  ← FRAME с TEXT-нодой внутри
│           │   └── Pins
│           ├── Health
│           ├── Mosque
│           └── Retail
└── Pins_Mobile                     ← viewport (nameIncludes 'mobile')
    └── ...та же иерархия
```

#### Структура выхода:
```js
export default {
    map_pins: {
        map_education: {
            svg: "map_pin_education",        // SVG иконки группы (desktop)
            iconWidth: 22,                    // ширина кружочка desktop
            iconHeight: 22,
            breakpoints: {
                768: {
                    svg: "map_pin_education_mob",
                    iconWidth: 40,
                    iconHeight: 40,
                },
            },
            pins: [
                {
                    language: ["en"],          // только если есть language-слои
                    zoom: 1,                   // только если есть zoom-слои (raw level)
                    left: 637,                 // ЦЕНТР Icon на карте (desktop)
                    top: 839,
                    isRight: false,            // подпись справа от пина?
                    text: "repton_school_abu_dhabi",
                    breakpoints: {
                        768: {
                            left: 646,
                            top: 848,
                            isRight: false,    // может отличаться от desktop
                        },
                    },
                },
                ...
            ],
        },
        map_health:    { svg, iconWidth, iconHeight, breakpoints, pins: [...] },
        map_mosque:    { svg, iconWidth, iconHeight, breakpoints, pins: [...] },
        map_retail:    { svg, iconWidth, iconHeight, breakpoints, pins: [...] },
    },
}
```

#### Поля per-group (общие для всех пинов группы):
| Поле | Источник |
|---|---|
| `svg` / `breakpoints.768.svg` | Имена SVG-файлов иконки: `map_pin_{group}` / `map_pin_{group}_mob` |
| `iconWidth`, `iconHeight` | Из bbox `Icon` фрейма первого пина группы (desktop/mobile) |

#### Поля per-pin (уникальные для каждого пина):
| Поле | Источник |
|---|---|
| `left`, `top` | **Центр** Icon-фрейма: `bbox.x + width/2 - originX`, `bbox.y + height/2 - originY` |
| `isRight` | `Name.center.x > Icon.center.x` (не по имени Name L/R, а по реальной позиции) |
| `text` | Slug от `characters` TEXT-ноды внутри Name-фрейма |
| `language` | Только если есть language-слои |
| `minZoom` / `maxZoom` | Только если есть zoom-слои. Логика как в landmarks v1: minZoom опускается для уровня 1; maxZoom = N.99 если на следующем zoom-уровне пина нет, иначе опускается. Подробнее — в `PINS_SPEC.md` |

#### SVG-имена (Pins):
- `map_pin_{group}` (desktop) / `map_pin_{group}_mob` (mobile)
- Не зависят от lang/zoom (иконка категории одинакова)
- Экспортируется по 2 файла на группу — нода Icon из первого встретившегося пина в desktop / mobile

#### Сопоставление desktop ↔ mobile пинов:
- По ключу `${text}|${lang}|${zoom}` — slug TEXT-ноды + lang + zoom (внутренний ключ, в выходе не сохраняется)
- Slug устойчив к различиям пробелов/переносов между desktop и mobile

#### Категория группы (откуда берётся имя `map_education`/...):
1. Если pin-фрейм лежит ВНУТРИ родительского слоя — имя родительского слоя (`"Education"`) → `map_education`
2. Если pin-фрейм лежит прямо под viewport/lang/zoom — асинхронно через `iconNode.getMainComponentAsync().name` → парсится `Type=Education` → `map_education`

#### Порядок элементов в выводе:
- Группы: в порядке desktop → mobile (первое появление в leaf-контейнере)
- Внутри группы — `pins[]`: для каждого `text` → для каждого `lang` → для каждого `zoom`
- Один и тот же (text, lang), присутствующий в нескольких zoom-слоях, порождает несколько записей подряд

#### Особенности:
- `isPinsContainerName(name)`: включает "pin", исключает "mobile"/"mob"/"desktop"/"desk"
  (чтобы `Pins_Hover_Desktop` распознавался как viewport, а не как root)
- `isPinFrameCandidate(node)`: pin-фрейм определяется по СТРУКТУРЕ — есть видимый child "icon"
  + хотя бы один другой видимый контентный child (label/hover). Имя самого pin-фрейма не важно
  (`"Pin"`, `"Pins"`, `"Pins "` — всё работает)
- Внутри пин-фрейма Icon — это child с именем содержащим "icon"; Name — любой другой
  FRAME/GROUP/INSTANCE child (имя может быть "Name L", "Name R", "Hover" — не важно)
- Скрытые ноды (`visible: false`) пропускаются на всех уровнях. У скрытого Name `absoluteBoundingBox = null`,
  что без фильтра роняло парсинг
- Пин без Icon, без Name или с пустым текстом — пропускается с warning в лог
- Цвета (`textColor`, `textBgColor`) берутся из первого пина группы через `node.fills` (SOLID-заливки)
- Переиспользует `getLanguageFrames`, `getZoomFrames` из `landmarks-detect.ts`
- `parsePins` асинхронная (из-за `getMainComponentAsync` для категории) — `Schema.parse`
  возвращает `ParseResult | Promise<ParseResult>`
- SVG config folder: `pins`

#### Варианты структуры (авто-определяет `detectPinsStructure`):
| Вариант | Флаги |
|---|---|
| `viewports` | только Mobile/Desktop — **дамп в `examples/dumps/pins.json`** |
| `viewports+languages` | + языковые слои |
| `viewports+zooms` | + зум-слои |
| `viewports+languages+zooms` | полная структура |

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
