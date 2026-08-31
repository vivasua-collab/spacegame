# План работы — Задача 24 (R-24 BLD-UI-SYN)

## Запрос владельца (4 пункта)

1. **Реальное отображение выработки энергии в построенном здании**: солнечная
   станция Lvl 1 показывает «+10/tick», а фактически генерирует по формуле
   P1-26: `10 × (1 + level×0.2) × светимость / орб.радиус × орб.бонус`.
2. **Синергия по типам зданий**: разделить здания по типам (генерирующие,
   добывающие, перерабатывающие и т.п.); для каждого типа — свой набор
   бонусов; подтипы (ядерная ↔ солнечная ЭС) НЕ дают бонусов друг другу;
   кросс-типовые бонусы — отложены. Электростанция: −5% энергопотребления
   смежному потребителю + у самой электростанции — бонус ГЕНЕРАЦИИ.
3. **Добывающие здания — бонус скорости добычи**, а не энергопотребления.
4. **Подтверждение сноса**: «Вы действительно хотите снести здание?»; при
   уровне > 1 — дополнительный вопрос «Здание выше 1-го уровня…».

## Дизайн-решения

- **Типы синергии** = производные от категории каталога (без изменения
  каталога): energy→generator, extraction→extractor, processing→processor,
  research→research, logistics→storage, production→production,
  colonization→colony, military→military. Псевдо-тип-роль `consumer` =
  любое здание с energyConsumption > 0. Подтип = buildingId (mine≠quarry,
  solar_plant≠nuclear_reactor).
- **SynergyRule v2**: sourceTypes/neighborTypes + sameSubtypeOnly (вместо
  sourceBuildingIds/neighborBuildingIds). Движок матчит по типам.
- **Активные правила** (кросс-типовые mine_processor и
  warehouse_production отложены, задокументированы в JSON-комментарии):
  - lab_cluster: research+research (same subtype) → research_rate +10%;
  - power_grid: consumer ← generator → energy_consumption −5%;
  - power_boost (НОВОЕ): generator ← consumer → energy_generation +5%;
  - mining_cluster (НОВОЕ): extractor+extractor (same subtype) →
    mining_speed +10%.
- **Движок**: recalcEnergyBalance — генераторы поверхности ×
  getEnergyGenerationMultiplier; processExtraction — добыча гексов ×
  getMiningSpeedMultiplier. Извлечён чистый хелпер getBuildingEnergyOutput
  (единая формула для engine + UI).
- **UI**: диалог здания показывает РЕАЛЬНЫЕ выработку/потребление (уровень,
  светимость, орбита, синергия); BuildList — проекцию на ур.1 на данной
  планете; подтверждения сноса через AlertDialog (2 шага при level > 1).

## Чеклист

- [x] 1. План создан (этот файл)
- [x] 2. core/types.ts: SynergyRule v2 (sourceTypes/neighborTypes/sameSubtypeOnly)
- [x] 3. synergy.json v2: типовые правила + power_boost + mining_cluster; кросс-типовые отложены
- [x] 4. data/buildings/synergy.ts: типизация (getSynergyBuildingType) + константы типов
- [x] 5. economy/adjacency.ts: матчинг по типам, sameSubtypeOnly, getEnergyGenerationMultiplier, getMiningSpeedMultiplier
- [x] 6. economy/engine.ts: getBuildingEnergyOutput (чистый хелпер) + интеграция генерации/добычи
- [x] 7. building-dialog.tsx: реальные выработка/потребление (hex + слоты + BuildList), метки целей
- [x] 8. building-dialog.tsx: подтверждения сноса (AlertDialog; 2 шага при ур.>1)
- [x] 9. scripts/validate-buildings.ts: валидация типов вместо id
- [x] 10. Тесты: обновить synergy-adjacency + новые кейсы (power_boost, mining_cluster, типы, подтипы)
- [x] 11. docs/40-buildings.md §5: типовая таблица, отложенные кросс-типы
- [x] 12. Гейты: lint 0/48 (=базовая 49) → tsc 156 (<159) → tests 513/513 (+17) → validate:all ✅
- [x] 13. Commit + push + worklog.md (append) — после браузерной верификации

## Примечания

- Откат к кросс-типовым правилам = дописать записи в synergy.json (data-driven).
- Dev-сервер остановлен на время кодинга (запрос владельца); запуск перед
  верификацией.
- Качество: тестов 513 (было 496); lint 0 errors; tsc −3 к базовой линии.
