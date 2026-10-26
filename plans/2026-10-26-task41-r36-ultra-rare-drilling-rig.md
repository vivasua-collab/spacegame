# Task 41 (R-36) — ultra_rare вариант (а): спека = код, drilling_rig в MVP

> Корректирующий проход после приёмки R-35 аудитором. Статус: **complete**
> (все пункты реализованы; гейты зелёные; браузерная верификация пройдена;
> отчёт — checkpoints/10_26_r36_ultra_rare_drilling_rig.md).
> Триггер: решения владельца по открытым вопросам `ultra_rare` (вариант «а») и PRNG.
> Этап 3 — только планирование (не исполняется), этап 4 запрещён.

## Решения владельца (задание)

1. **ultra_rare — вариант (а)**: код соответствует docs/31-resources.md, пул
   уникальных = `Ir, Os, Re, Ru, Rh, Pd, Hf, Ta, Nb, Zr`; **drilling_rig входит
   в MVP** как реальное доступное здание. Реализовать ЦЕЛИКОМ (пул + здание +
   весь путь добычи + тесты + аудит rarity).
2. **PRNG**: канонический xoshiro128** подтверждён (32 бита достаточно);
   добавить защиту от полностью нулевого состояния в конструкторе + тест;
   в нормализаторе отдельно обработать `arms = +Infinity` + тест.
3. **Отчётность**: STATUS/README/чекпоинты согласованы; полный suite; отдельно
   указать, что production build не запускался (запрещён платформой, dev-only)
   и CI в репозитории нет.

## Изменения

### Q1 — ultra_rare (вариант а)

| # | Файл | Что |
|---|------|-----|
| 1.1 | `src/data/planet-types.ts` | `RARE_ELEMENTS` = docs/31 §2 rare (Co,W,Mo,V,Ag,Pt,Au,U,Li,Be); `ULTRA_RARE_ELEMENTS` = docs/31 §2 ultra_rare (Ir,Os,Re,Ru,Rh,Pd,Hf,Ta,Nb,Zr); комментарий: семантика слоёв (базовая редкость vs планетарные пулы), решение владельца |
| 1.2 | `src/data/elements.ts` | rarity-маппинг (таблица соответствия, 5 элементов): Pt ultra_rare→rare, Au ultra_rare→rare, U ultra_rare→rare, Be ultra_rare→rare, Zr rare→ultra_rare; регрессионный тест-снапшот распределения (14/12/13/21) |
| 1.3 | `src/galaxy/generate-resources.ts` | новая ветка генерации для пула ULTRA_RARE (следовые количества ×0.05, depth 4–5, availability 0.02–0.10) — иначе после синхронизации пула (все 10 = deep_ore с обычной веткой qty 6–42/гекс) все кандидаты получали бы qty ≥ 10 → `eligibleUltra` пуст → 0 уникальных на планете (регрессия G-06); `DEPOSIT_RNG_VERSION = 2` + `migrateDepositsIfNeeded` |
| 1.4 | `src/data/buildings/surface.json` | здание `drilling_rig` (extraction, surface, все размеры, энергия 4, 10 уровней, стоимость Fe/Ti/Cu, без requiresTechs — в MVP-каталоге 15 технетехнологий нет «Глубокого бурения», гейт отложен явно задокументировано) |
| 1.5 | `src/economy/engine.ts` | `canMineDeposit(+buildingLevel)`: порог `BakedOre.minSourceLevel` (данные уже в хим.модели: Re=8, Rh/Ta/Pd/Dy=6, большинство=5, Y=2, Ba=1); mine/quarry все = 1 → поведение без изменений; комментарии «post-MVP» → MVP |
| 1.6 | `src/lib/save-format-v3.ts` | поле `dv` (версия RNG залежей) при записи `ds`; чтение → `depositRngVersion` |
| 1.7 | `src/stores/game-store.ts` | `deserializeGameState`: явная миграция — тела с `dm=false` и `dv ≠ 2` материализуются при загрузке (защита сейвов со снятыми залежами вне пересозданного окружения) |
| 1.8 | `src/core/types.ts`, `src/galaxy/generate-planets.ts` | `depositRngVersion?: number` на Planet/Moon; запись версии при генерации |
| 1.9 | UI | `reference-dialog.tsx`: хинт «Буровая установка в MVP не реализована» → актуальный; building-dialog: сверка упоминаний |

### Q2 — PRNG/нормализатор

| # | Файл | Что |
|---|------|-----|
| 2.1 | `src/core/prng.ts` | защита от [0,0,0,0]-состояния в конструкторе (после splitMix64 → word0=1, как в fromState/derive) |
| 2.2 | `src/galaxy/generate-positions.ts` | `arms`: Number.isFinite-нормализация (раньше `Math.floor(+Infinity)||1 = Infinity` → `nextInt(0,∞)` → NaN/Inf-координаты) |

### Тесты

- `tests/economy/extraction-roles.test.ts`: позитив — drilling_rig добывает КАЖДУЮ
  из 10 спековых руд; негатив — mine/quarry/colony_hub НЕ добывают ни одну;
  порог minSourceLevel (Re-ore: ур.7 нет / ур.8 да); регрессия: у всех
  mine/quarry-руд minSourceLevel=1.
- `tests/galaxy/deposits.test.ts`: пулы === спискам docs/31 §2 (verbatim),
  дизъюнктность, пул ⊆ класс rarity, все 10 руд пула = deep_ore/drilling_rig;
  статистика 100 seed × 1200 планет — у каждой 1–2 уникальных из спека-пула,
  кандидаты никогда не пусты; ultra-ветка: depth 4–5, следовые количества.
- `tests/prng.test.ts`: нулевое состояние — конструктор(0)/fromState([0,0,0,0])
  дают не-нулевое состояние и конечные выходы.
- `tests/galaxy/galaxy-positions.test.ts`: arms = +∞/−∞/NaN/0/2.7 → все
  координаты конечны, armAngleStep конечен.
- `tests/save-format-v3.test.ts`: dv-рантрип; миграция старого ds при загрузке.

### Документация

- `docs/31-resources.md`: §5.2/§6.1 — drilling_rig больше не post-MVP; §10.4 —
  семантика rarity vs планетарные пулы; changelog.
- `docs/40-buildings.md`: §2.4 — статус MVP, гейт технологии отложен
  (в MVP-каталоге нет «Глубокого бурения»), уровневые пороги = minSourceLevel.
- `docs/STATUS.md`, `README.md`, чекпоинт `checkpoints/10_26_r36_*.md`, worklog.

## Гейты приёмки (критерий закрытия этапа 2)

- bun test — все зелёные (693+ новых/обновлённых);
- lint 0 errors; tsc src — дельта ≤ 0; validate:all 4/4;
- кросс-процессный sha256-детерминизм генерации;
- Save → Load → materialize бит-в-бит; миграция dv;
- браузерная верификация: новая игра → колонизация → постройка буровой →
  добыча глубинной руды → Save/Load;
- production build НЕ запускается (запрещён платформой), CI в репо нет —
  отразить в отчёте явно;
- без пуша до окончания прохода; затем коммит R-36 + push (практика R-35).

## Осознанные ограничения (для утверждения владельцем)

1. Тех-гейт «Глубокое бурение» (docs/40 §2.4) не реализуем в MVP — в каталоге
   15 технологий нет такой; здание доступно сразу (как mine/quarry).
   Гейт отложен до расширения tech-tree (Этап 3+).
2. Бонусы геологической активности по типу планеты (§2.4) не реализуются —
   формула добычи едина с шахтой/карьером (availability × level × terrain ×
   synergy); террейн-бонус буровой задаёт каталог (mountains/volcano).
3. Смена веток генерации сдвигает RNG-поток → залежи ВСЕХ seed изменились
   (детерминизм сохранён); сейвы с `dm=false` мигрируют при загрузке (dv).
4. Базовое присутствие ultra_rare в следовой ветке — эвристика ×0.05 от
   обычной ветки (пропорция docs/31 §3.2 rare:ultra = 0.1 приближена
   отношением 0.05/0.15 к редкой ветке).
