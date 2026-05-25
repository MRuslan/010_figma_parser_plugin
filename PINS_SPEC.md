# Map Pins — Спецификация компонента

Документ описывает, как реализовать компонент **Map Pins** в проекте на основе конфигов, которые выгружает плагин Figma Parser (схема `pins`).

---

## 1. Что такое пин

**Пин** — интерактивный маркер POI (point of interest) на карте.

Визуально состоит из двух частей:
1. **Icon** — кружочек с SVG-символом внутри (например, символ школы, больницы, мечети)
2. **Label** — подпись с названием места, появляющаяся при наведении/тапе

Пины делятся на **группы** (категории): `map_education`, `map_health`, `map_mosque`, `map_retail`, и т.д.
Внутри группы все пины используют **одну SVG-иконку и одинаковый размер кружочка** — отличаются только позицией и подписью.

---

## 2. Входные конфиги

Плагин выгружает **три** файла для пинов:

### 2.1. `map_pins.js` — главный конфиг

```js
export default {
    map_pins: {
        map_education: {
            // ─── Параметры группы ──
            svg: "map_pin_education",       // имя SVG-файла иконки (desktop)
            iconWidth: 22,                   // ширина кружочка desktop
            iconHeight: 22,
            textColor: "#1e1e1e",            // цвет текста подписи
            textBgColor: "#ffffff",          // цвет фона подписи
            breakpoints: {
                768: {                       // переопределения для mobile (< 768px)
                    svg: "map_pin_education_mob",
                    iconWidth: 40,
                    iconHeight: 40,
                    textColor: "#1e1e1e",
                    textBgColor: "#ffffff",
                },
            },
            // ─── Сами пины группы ──
            pins: [
                {
                    left: 637,               // X-координата ЦЕНТРА иконки на карте (desktop)
                    top: 839,                // Y-координата ЦЕНТРА иконки
                    isRight: false,          // подпись справа от иконки? (false = слева)
                    text: "repton_school_abu_dhabi",  // ключ для i18n
                    breakpoints: {
                        768: {
                            left: 646,       // позиция на mobile
                            top: 848,
                            isRight: false,  // сторона подписи может отличаться от desktop
                        },
                    },
                },
                // ... остальные пины группы
            ],
        },
        map_health:    { svg, iconWidth, iconHeight, textColor, textBgColor, breakpoints, pins: [...] },
        map_mosque:    { svg, iconWidth, iconHeight, textColor, textBgColor, breakpoints, pins: [...] },
        map_retail:    { svg, iconWidth, iconHeight, textColor, textBgColor, breakpoints, pins: [...] },
        // ... другие группы
    },
};
```

#### Опциональные поля пинов (появляются только при соответствующих слоях в Figma)

```js
{
    language: ["en"],                // только если в Figma были language-слои
    zoom: 1,                         // только если в Figma были zoom-слои
    left, top, isRight, text, breakpoints,
}
```

При наличии language/zoom-слоёв **один логический пин разворачивается в несколько элементов** массива: по одному на каждую комбинацию (lang × zoom). Фронт должен фильтровать массив по текущему `language` и `zoom`.

### 2.2. `pins-svg.js` — SVG paths

```js
export default {
    "map_pin_education":     "./svg/map/[name_map]/pins/map_pin_education.svg",
    "map_pin_education_mob": "./svg/map/[name_map]/pins/map_pin_education_mob.svg",
    "map_pin_health":        "./svg/map/[name_map]/pins/map_pin_health.svg",
    "map_pin_health_mob":    "./svg/map/[name_map]/pins/map_pin_health_mob.svg",
    // ...
};
```

`[name_map]` — плейсхолдер, заменяется на имя конкретной карты (например, `abu_dhabi`).

### 2.3. `pins-translations.js` — переводы подписей

```js
export default {
    repton_school_abu_dhabi: {
        en: "Repton School<br>Abu Dhabi",        // <br> — место для переноса строки
        ar: "...",                               // язык(и) появляется(ются) если в Figma были language-слои
    },
    amity_international_school: {
        en: "Amity International School",
    },
    // ...
};
```

Ключ — это `text` поле из главного конфига; значение — объект `{ lang: string }`.

---

## 3. Координатная система

### Главное правило

> `pin.left` / `pin.top` — это **координаты ЦЕНТРА иконки**, а не верхний-левый угол.

Чтобы отрисовать пин, нужно сдвинуть его на половину `iconWidth` / `iconHeight`:

```
x_screen = pin.left - iconWidth / 2
y_screen = pin.top  - iconHeight / 2
```

Координаты заданы относительно **origin карты** — левого-верхнего угла фрейма карты в Figma (например, `0,0` соответствует верхнему-левому углу самой картинки карты).

### Масштабирование

Карта в Figma имеет фиксированную ширину (например, **1600px** для desktop, **1024px** для mobile — уточнить под проект). В рендере:

```js
const scale = mapElementWidth / FIGMA_MAP_WIDTH;
const pinX = (pin.left - iconWidth / 2) * scale;
const pinY = (pin.top  - iconHeight / 2) * scale;
```

`iconWidth`/`iconHeight` тоже масштабируются:
```js
const renderedIconSize = iconWidth * scale;
```

---

## 4. Логика подписи (`isRight`)

- `isRight: false` → подпись появляется **слева** от иконки (`right edge of label` ≈ `left edge of icon`)
- `isRight: true` → подпись появляется **справа** от иконки (`left edge of label` ≈ `right edge of icon`)

Подпись **вертикально центрирована** относительно центра иконки.

```
isRight: false:                         isRight: true:

   [Label text  ]●                            ●[  Label text]
                                              
   подпись слева                              подпись справа
```

Логика построения через CSS (пример):

```css
.pin {
    position: absolute;
    /* (pin.left - iconWidth/2, pin.top - iconHeight/2) */
}

.pin__label {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;            /* подпись в одну логическую строку, кроме <br> */
    background: var(--text-bg-color);
    color: var(--text-color);
}

.pin__label--left  { right: 100%; margin-right: 4px; }  /* isRight: false */
.pin__label--right { left:  100%; margin-left:  4px; }  /* isRight: true */
```

`isRight` в `breakpoints.768` может отличаться от базового — если в дизайне на mobile подпись для этого пина перенесена на другую сторону (мало места и т.п.). Это нормально.

---

## 5. Адаптивность (breakpoints)

Структура `breakpoints` устроена как **переопределение полей для mobile**:

```js
{
    // ── base — применяется по умолчанию (desktop) ──
    svg: "map_pin_education",
    iconWidth: 22,
    breakpoints: {
        // ── 768: применяется когда вьюпорт ≤ 768px ──
        768: {
            svg: "map_pin_education_mob",
            iconWidth: 40,
        },
    },
}
```

Логика выбора (псевдокод):

```ts
function resolve<T>(base: T, breakpoint: number | null): T {
    if (breakpoint === 768 && base.breakpoints?.[768]) {
        return { ...base, ...base.breakpoints[768] };
    }
    return base;
}
```

Применяется к **обоим уровням** (группа и пин).

### Граница mobile / desktop

По умолчанию `768px`. CSS-логика:

```css
@media (max-width: 767px) { /* mobile */ }
@media (min-width: 768px) { /* desktop */ }
```

(или подобное, в зависимости от стандарта проекта)

---

## 6. Поведение

### 6.1. Состояние "default"

Видна только иконка. Подпись скрыта или появляется только при hover/tap.

### 6.2. Состояние "hover" / "active" (desktop)

При наведении мышью:
- Иконка может слегка увеличиться или сменить заливку (этот спек не задаёт — оставляем на дизайнера/разработчика)
- Подпись **появляется** с фоном `textBgColor` и текстом `textColor`

### 6.3. Состояние "active" (mobile)

На тач-устройствах:
- Подпись по умолчанию **может быть видна постоянно** ИЛИ показывается на тап
- Решение принимается командой UX (этот спек не диктует)

### 6.4. Клик

Клик по пину открывает страницу/модалку соответствующего POI. Соответствие пина → URL/ID решается через `pin.text` (slug) — он же ключ переводов.

---

## 7. Переводы

### Получение текста

```ts
function getPinLabel(pin, lang = 'en') {
    const translations = i18nConfig[pin.text];
    return translations?.[lang] ?? translations?.en ?? pin.text;
}
```

### Рендер `<br>` в подписи

Значение в i18n использует литеральный тег `<br>` для переноса строки. В React можно либо:

```jsx
// Через innerHTML (если переводы доверенные):
<span dangerouslySetInnerHTML={{ __html: label }} />

// Или разбить на массив и вставить <br/> JSX:
{label.split('<br>').map((line, i, arr) => (
    <Fragment key={i}>
        {line}
        {i < arr.length - 1 && <br/>}
    </Fragment>
))}
```

---

## 8. SVG-ассеты

### Структура папок (после распаковки zip из плагина)

```
public/
  svg/
    map/
      [name_map]/                  ← подставить имя карты (abu_dhabi и т.п.)
        pins/
          map_pin_education.svg
          map_pin_education_mob.svg
          map_pin_health.svg
          map_pin_health_mob.svg
          map_pin_mosque.svg
          map_pin_mosque_mob.svg
          map_pin_retail.svg
          map_pin_retail_mob.svg
        landmarks/
          ...
        ...
```

### Что внутри SVG

Каждый файл — **полностью отрисованная иконка пина** (кружочек + внутренний символ). Размер `viewBox` соответствует `iconWidth × iconHeight` из конфига (desktop 22×22, mobile 40×40).

В рендере SVG вставляется как `<img>`, `<object>`, или инлайнится через `<svg>` — на усмотрение проекта.

---

## 9. Полный пример отрисовки (React + псевдо-CSS)

```tsx
import pinsConfig from './map_pins.js';
import pinsSvg from './pins-svg.js';
import pinsI18n from './pins-translations.js';

interface MapPinsProps {
    isMobile: boolean;
    lang: 'en' | 'ar';
    mapWidth: number;       // отрисованная ширина карты в px
}

const FIGMA_MAP_WIDTH = 1600;  // ширина карты в Figma — настроить под проект

export function MapPins({ isMobile, lang, mapWidth }: MapPinsProps) {
    const scale = mapWidth / FIGMA_MAP_WIDTH;

    return Object.entries(pinsConfig.map_pins).map(([groupKey, group]) => {
        // Резолвим переопределение для текущего breakpoint
        const g = isMobile ? { ...group, ...group.breakpoints[768] } : group;

        return (
            <div key={groupKey} className={`pins-group pins-${groupKey}`}>
                {group.pins.map((pin, idx) => {
                    const p = isMobile ? { ...pin, ...pin.breakpoints[768] } : pin;
                    const iconW = g.iconWidth * scale;
                    const iconH = g.iconHeight * scale;
                    const label = pinsI18n[pin.text]?.[lang] ?? pin.text;

                    return (
                        <button
                            key={pin.text + idx}
                            className="pin"
                            style={{
                                position: 'absolute',
                                left: (p.left - g.iconWidth / 2) * scale,
                                top:  (p.top  - g.iconHeight / 2) * scale,
                                width: iconW,
                                height: iconH,
                            }}
                            aria-label={label.replace(/<br>/g, ' ')}
                        >
                            <img
                                src={pinsSvg[g.svg]}
                                width={iconW}
                                height={iconH}
                                alt=""
                            />
                            <span
                                className={`pin__label pin__label--${p.isRight ? 'right' : 'left'}`}
                                style={{ color: g.textColor, background: g.textBgColor }}
                                dangerouslySetInnerHTML={{ __html: label }}
                            />
                        </button>
                    );
                })}
            </div>
        );
    });
}
```

---

## 10. Чек-лист интеграции

- [ ] Подключить 3 конфига: `map_pins.js`, `pins-svg.js`, `pins-translations.js`
- [ ] Положить SVG-файлы в `public/svg/map/{name}/pins/`
- [ ] Заменить плейсхолдер `[name_map]` в `pins-svg.js` на имя карты
- [ ] Передавать в компонент текущий `isMobile`, `lang`, `mapWidth`
- [ ] Учесть: `left`/`top` — это центр иконки, сдвигать на `-iconWidth/2`, `-iconHeight/2`
- [ ] Масштабировать координаты и размер иконки на `mapWidth / FIGMA_MAP_WIDTH`
- [ ] Обрабатывать `<br>` в подписи (через `dangerouslySetInnerHTML` или разбиение)
- [ ] Цвета подписи (`textColor`, `textBgColor`) применять как CSS-переменные / inline-стили
- [ ] Hover/tap логика появления подписи — на усмотрение UX
- [ ] При наличии `language`/`zoom` в массиве `pins` — фильтровать по текущему состоянию

---

## 11. Что НЕ входит в конфиг (решается на стороне фронта)

| Аспект | Где решается |
|---|---|
| Анимация появления/исчезновения подписи | CSS / framer-motion |
| Hover state иконки (увеличение, тень) | CSS |
| Клик-обработчик и навигация | роутер проекта |
| Семантика `aria-label`, accessibility | компонент |
| Z-index пинов относительно других слоёв карты | стили проекта |
| Группировка/кластеризация при большом зуме | алгоритм проекта |
| Шрифт и размер подписи | дизайн-токены проекта |
