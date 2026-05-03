# Чекпоинт: Colony Hub + Colonization Flow — План

**Дата:** 2026-05-03 22:01 MSK
**Фаза:** 2 — UI/UX + Gameplay Start
**Статус:** ✅ completed

## Предыдущие результаты (из 05_03_colony_start.md)
- ✅ G-24: PRNG derive() исправлен (6/6 тестов PASS)
- ✅ G-25: Размер 'large' теперь генерируется
- ✅ G-27: Океанические планеты 7.9%
- ✅ G-29: Минимальная гравитация ГГ 0.94g

## Текущая задача: Colony Hub + Colonization Flow

### Проблема
- Нет здания колонизации — только giveStarterResources() + автоматическая солнечная станция
- Нет UI-флоу для старта: игрок не выбирает планету для колонизации
- Игра сразу начинается с первой планеты, без выбора

### Решение: Colony Hub

**Colony Hub (Колониальный хаб)** — стартовое здание, которое:
1. Производит базовую энергию (5 единиц, без зависимости от светимости — работает как компактный генератор)
2. Добывает все залежи на гексе со скоростью 50% от шахты
3. Бесплатно (автоматически размещается при колонизации)
4. Можно строить только на незанятых гексах планеты без владельца
5. Единственное здание, которое можно построить на ещё не колонизированной планете

### Реализация (4 файла)

#### 1. src/data/buildings.ts
```typescript
{
  id: 'colony_hub',
  name: 'Колониальный хаб',
  description: 'Стартовое здание колонии: базовая энергия и добыча ресурсов',
  category: 'colonization',  // Новая категория
  layer: ['surface'],
  size: ['tiny', 'small', 'medium', 'large', 'huge'],
  energyConsumption: 0,      // Производит, не потребляет
  baseProductionTime: 0,
  levels: 3,                 // 3 уровня улучшения
  costPerLevel: {},          // Бесплатно на уровне 1, улучшение стоит ресурсы
  terrainBonus: {},
  requiresAtmosphere: false,
}
```

#### 2. src/economy/engine.ts
- processExtraction: colony_hub извлекает все deposits на гексе с множителем 0.5
- recalcEnergyBalance: colony_hub = 5 базовой энергии × levelMult (не зависит от светимости)

#### 3. src/stores/game-store.ts
- Удалить автоматическую солнечную станцию из createInitialState
- Заменить автоматическую колонизацию на ручной выбор
- Добавить GamePhase 'colonization' (выбор планеты)
- Добавить `colonizePlanet(planetId)` — ставит colony_hub + giveStarterResources + owner='player'
- Игрок начинает с видом на галактику, выбирает систему, затем планету

#### 4. UI компоненты
- system-view.tsx: кнопка "Colonize" на каждой пригодной планете
- game-layout.tsx: подсказка при фазе 'colonization'
- planet-view.tsx: индикатор принадлежности (owner)
- buildings.ts CATEGORY_NAMES: добавить 'colonization': 'Колонизация'

### Порядок действий
1. ✅ buildings.ts → colony_hub + CATEGORY_NAMES + CATEGORY_ICONS
2. ✅ engine.ts → colony_hub в processExtraction + recalcEnergyBalance + colonizePlanet()
3. ✅ game-store.ts → colonizePlanet() + фаза 'colonization' (нет автосолнечной станции)
4. ✅ UI → кнопки колонизации + индикаторы (system-view, planet-view, building-dialog, game-layout)
5. ✅ Lint + dev check — чисто, HTTP 200

### Итог проверки (2026-05-03)
Все 4 пункта реализованы полностью:
- **buildings.ts**: colony_hub определён, CATEGORY_NAMES['colonization']='Колонизация', CATEGORY_ICONS['colonization']='🏠'
- **engine.ts**: colony_hub добывает 50% от шахты (0.005 rate), энергия 5×levelMult, colonizePlanet() ставит на лучший гекс
- **game-store.ts**: phase='colonization' при старте, colonizePlanet action, после колонизации → phase='playing', speed=1
- **UI**: system-view — кнопка «Колонизировать» + Badge «Колония» + TYPE_NAMES/SIZE_NAMES; planet-view — cyan цвет для colony_hub; building-dialog — colony_hub исключён из списка; game-layout — баннер колонизации
- Dev-сервер: PID 22126, порт 3000, HTTP 200, lint чист
