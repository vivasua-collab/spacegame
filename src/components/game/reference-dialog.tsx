'use client';

/**
 * R-BLD-REF: Справочное меню (Reference / Help dialog).
 *
 * Легенда + описание игровых подсистем:
 *   - Планеты:    легенда размеров (hex count) и типов планет (baseGravity,
 *                 temperature, atmosphereChance).
 *   - Исследования: фундаментальные ветки + специализированные ветки + очередь.
 *   - Экономика:   раздельные склады (ore/processed/highTech) + категории ресурсов.
 *   - Флот:        типы корпусов + типы топлива.
 *   - Здания:      полный каталог BUILDINGS с категорией, стоимостью, слоями.
 *
 * Точки интеграции:
 *   - data/planet-types.ts     → PLANET_TYPES, SIZE_HEX_COUNT, SIZE_NAMES, TYPE_NAMES.
 *   - data/buildings.ts        → BUILDINGS, CATEGORY_NAMES, LAYER_NAMES.
 *   - data/research/index.ts   → FUNDAMENTAL_BRANCHES_MVP, TECH_TREE (barrel re-exports
 *                                — работает даже если R-RES рефакторит в JSON, т.к.
 *                                barrel останется точкой входа).
 *   - data/warehouse.ts        → ORE/PROCESSED/HIGH_TECH константы вместимости.
 *   - data/ships/hulls.ts      → HULLS.
 *   - data/ships/fuel-map.ts   → FUEL_TO_ELEMENT, ALL_FUEL_TYPES.
 *
 * Стилизация: тёмная тема (`bg-[#0d0d24]`, `border-white/10`), как и все игровые
 * диалоги. Левая колонка-табы, правая — содержимое. На мобильных табы
 * сворачиваются в горизонтальный скролл-ряд над контентом.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Globe2,
  FlaskConical,
  Boxes,
  Rocket,
  Hammer,
} from 'lucide-react';

// ─── Планеты ────────────────────────────────────────────────────────────
import {
  PLANET_TYPES,
  SIZE_HEX_COUNT,
  SIZE_NAMES,
  TYPE_NAMES,
} from '@/data/planet-types';
import type { PlanetSize, PlanetType } from '@/core/types';

// ─── Здания ──────────────────────────────────────────────────────────────
import {
  BUILDINGS,
  CATEGORY_NAMES,
  LAYER_NAMES,
} from '@/data/buildings';

// ─── Экономика ───────────────────────────────────────────────────────────
import {
  ORE_WAREHOUSE_BASE,
  ORE_WAREHOUSE_PER_LEVEL,
  PROCESSED_WAREHOUSE_BASE,
  PROCESSED_WAREHOUSE_PER_LEVEL,
  HIGH_TECH_STORAGE_BASE,
  HIGH_TECH_STORAGE_PER_LEVEL,
  SPACEPORT_PER_LEVEL,
} from '@/data/warehouse';
import { CATEGORY_LABELS } from '@/data/element-helpers';
import type { ElementCategory } from '@/core/types';

// ─── Флот ────────────────────────────────────────────────────────────────
import { HULLS } from '@/data/ships/hulls';
import {
  ALL_FUEL_TYPES,
} from '@/data/ships/fuel-map';

// ─── Исследования ─────────────────────────────────────────────────────────
// Импорт через barrel — безопасен при рефакторинге R-RES (JSON loader).
import {
  FUNDAMENTAL_BRANCHES_MVP,
  TECH_TREE,
  TECH_MAP,
} from '@/data/research/index';

// ============================================================================
// КОНСТАНТЫ ДЛЯ UI
// ============================================================================

const PLANET_SIZE_ORDER: PlanetSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];
const PLANET_TYPE_ORDER: PlanetType[] = [
  'rocky', 'volcanic', 'ice', 'oceanic', 'desert', 'gas_giant', 'dwarf',
];

const FUEL_TYPE_LABELS: Record<string, string> = {
  chemical: 'Химическое (H)',
  xenon: 'Ксенон (Xe)',
  hydrogen: 'Водород (H)',
  antimatter: 'Антиматерия (Etap 4)',
};

const BRANCH_LABELS: Record<string, string> = {
  power: 'Энергия',
  materials: 'Материалы',
  weapons: 'Оружие',
  computing: 'Вычисления',
  biology: 'Биология',
  xenoarch: 'Ксеноархеология',
};

// ============================================================================
// КОРНЕВОЙ КОМПОНЕНТ
// ============================================================================

export function ReferenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-4xl max-h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-white/10">
          <DialogTitle className="flex items-center gap-2 text-cyan-200">
            <span className="text-cyan-400">📖</span>
            Справка
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Легенды и описания игровых подсистем. Выберите вкладку слева.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="planets" className="flex-1 flex flex-col min-h-0">
          {/* TabsList — горизонтальный ряд на мобильных, вертикальный на десктопе */}
          <TabsList className="bg-white/5 flex flex-col sm:flex-row h-auto sm:h-9 w-full sm:w-56 shrink-0 rounded-none border-b border-white/10 p-1 gap-1">
            <TabsTrigger
              value="planets"
              className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200 text-slate-300 justify-start text-xs h-8 sm:h-[calc(100%-1px)]"
            >
              <Globe2 className="size-3.5 mr-1.5" />
              Планеты
            </TabsTrigger>
            <TabsTrigger
              value="research"
              className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200 text-slate-300 justify-start text-xs h-8 sm:h-[calc(100%-1px)]"
            >
              <FlaskConical className="size-3.5 mr-1.5" />
              Исследования
            </TabsTrigger>
            <TabsTrigger
              value="economy"
              className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200 text-slate-300 justify-start text-xs h-8 sm:h-[calc(100%-1px)]"
            >
              <Boxes className="size-3.5 mr-1.5" />
              Экономика
            </TabsTrigger>
            <TabsTrigger
              value="fleet"
              className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200 text-slate-300 justify-start text-xs h-8 sm:h-[calc(100%-1px)]"
            >
              <Rocket className="size-3.5 mr-1.5" />
              Флот
            </TabsTrigger>
            <TabsTrigger
              value="buildings"
              className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200 text-slate-300 justify-start text-xs h-8 sm:h-[calc(100%-1px)]"
            >
              <Hammer className="size-3.5 mr-1.5" />
              Здания
            </TabsTrigger>
          </TabsList>

          {/* Контент-зона с прокруткой */}
          <div className="flex-1 min-h-0 max-h-[68vh] overflow-y-auto p-4 custom-scrollbar">
            <TabsContent value="planets" className="mt-0 outline-none">
              <PlanetsTab />
            </TabsContent>
            <TabsContent value="research" className="mt-0 outline-none">
              <ResearchTab />
            </TabsContent>
            <TabsContent value="economy" className="mt-0 outline-none">
              <EconomyTab />
            </TabsContent>
            <TabsContent value="fleet" className="mt-0 outline-none">
              <FleetTab />
            </TabsContent>
            <TabsContent value="buildings" className="mt-0 outline-none">
              <BuildingsTab />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// ВКЛАДКА: ПЛАНЕТЫ
// ============================================================================

function PlanetsTab() {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Легенда размеров
        </h3>
        <p className="text-xs text-slate-400 mb-2">
          Количество гексов на планете зависит только от её размера.
          Радиус планеты (в R⊕) определяет размер через getSizeFromRadius().
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PLANET_SIZE_ORDER.map((size) => (
            <div
              key={size}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-center"
            >
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {SIZE_NAMES[size]}
              </div>
              <div className="text-lg font-mono text-cyan-300 mt-1">
                {SIZE_HEX_COUNT[size]}
              </div>
              <div className="text-[10px] text-slate-500">гексов</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Типы планет
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-white/10">
                <th className="text-left py-1.5 pr-3 font-medium">Тип</th>
                <th className="text-right py-1.5 px-2 font-medium">Гравит.</th>
                <th className="text-right py-1.5 px-2 font-medium">T °C</th>
                <th className="text-right py-1.5 px-2 font-medium">Гексов</th>
                <th className="text-right py-1.5 pl-2 font-medium">Атмосфера</th>
              </tr>
            </thead>
            <tbody>
              {PLANET_TYPE_ORDER.map((type) => {
                const def = PLANET_TYPES.find((p) => p.type === type);
                if (!def) return null;
                return (
                  <tr
                    key={type}
                    className="border-b border-white/5 hover:bg-white/5"
                  >
                    <td className="py-1.5 pr-3 text-slate-200 font-medium">
                      {TYPE_NAMES[type]}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-amber-300">
                      {def.baseGravity.toFixed(1)}G
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-orange-300">
                      {def.temperatureRange[0]}…{def.temperatureRange[1]}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-cyan-300">
                      {def.hexCount === 0 ? '—' : def.hexCount}
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono text-emerald-300">
                      {Math.round(def.atmosphereChance * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Газовые гиганты не имеют поверхности — застройка только в атмосфере и на орбите.
          Гравитация в таблице — базовая (фактическая считается из радиуса и плотности).
        </p>
      </section>
    </div>
  );
}

// ============================================================================
// ВКЛАДКА: ИССЛЕДОВАНИЯ
// ============================================================================

function ResearchTab() {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Фундаментальные ветки (5 в MVP)
        </h3>
        <p className="text-xs text-slate-400 mb-2">
          Базовая стоимость: 200 RP. Макс. уровень: 10. Каждая ветка поднимает
          потолок связанной специализированной ветки и даёт partial-бонус.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FUNDAMENTAL_BRANCHES_MVP.map((b) => (
            <div
              key={b.id}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-medium text-cyan-200">{b.name}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1 text-slate-400 border-white/20">
                  200 RP / lvl
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {b.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Специализированные ветки (15 технологий)
        </h3>
        <p className="text-xs text-slate-400 mb-2">
          Стоимость уровня N: <code className="text-cyan-300 bg-white/5 px-1 rounded">floor(baseCost × 1.5^(N−1))</code>.
          Прекурситы — DAG (до 3 AND, без OR). Кросс-веточные связи:
          M5 superconductors ← M1+C1, W2 laser_weapons ← W1+C1.
        </p>
        <div className="space-y-3">
          {(['power', 'materials', 'weapons', 'computing', 'biology'] as const).map((branch) => {
            const techs = TECH_TREE.filter((t) => t.branch === branch).sort(
              (a, b) => a.sortOrder - b.sortOrder,
            );
            return (
              <div key={branch}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  {BRANCH_LABELS[branch] ?? branch}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {techs.map((t) => (
                    <div
                      key={t.id}
                      className="rounded border border-white/5 bg-white/[0.03] px-2 py-1.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-slate-200 font-medium">
                          {t.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {t.baseCost} RP
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
                        {t.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Очередь исследований
        </h3>
        <ul className="text-xs text-slate-300 list-disc list-inside space-y-1">
          <li>
            Лаборатория даёт RP/сек = <code className="text-cyan-300 bg-white/5 px-1 rounded">5 × уровень × (1 + габитабельность/800)</code>.
          </li>
          <li>
            Каждые 10 лабораторий в империи открывают +1 параллельный слот исследований.
          </li>
          <li>
            Очередь можно ставить на паузу или перенаправлять RP через аллокацию слотов.
          </li>
          <li>
            При завершении уровня технологии эмитятся <code className="text-cyan-300 bg-white/5 px-1 rounded">tech:unlocked</code> события: рецепт, модуль корабля, здание или корпус.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ============================================================================
// ВКЛАДКА: ЭКОНОМИКА
// ============================================================================

function EconomyTab() {
  const warehouseTiers = [
    {
      id: 'ore',
      label: 'Рудный (открытый)',
      building: 'open_warehouse',
      base: ORE_WAREHOUSE_BASE,
      perLevel: ORE_WAREHOUSE_PER_LEVEL,
      accent: 'text-amber-300',
      hint: 'Руды, газы (сырые), ледяные соединения.',
    },
    {
      id: 'processed',
      label: 'Переработанный (крытый)',
      building: 'warehouse',
      base: PROCESSED_WAREHOUSE_BASE,
      perLevel: PROCESSED_WAREHOUSE_PER_LEVEL,
      accent: 'text-cyan-300',
      hint: 'Чистые элементы abundant/common, конструкционные материалы, броня.',
    },
    {
      id: 'highTech',
      label: 'Высокотехнологичный',
      building: 'high_tech_storage',
      base: HIGH_TECH_STORAGE_BASE,
      perLevel: HIGH_TECH_STORAGE_PER_LEVEL,
      accent: 'text-emerald-300',
      hint: 'Микрочипы, сверхпроводники, электроника, редкие/уникальные элементы.',
    },
  ];

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Раздельные склады (v3.0)
        </h3>
        <p className="text-xs text-slate-400 mb-2">
          Единица измерения: 1 ед. = 1 млн т = 0.001 млрд т.
          Стартовая суммарная вместимость = 10 000 ед. (5000 + 3500 + 1500).
        </p>
        <div className="space-y-2">
          {warehouseTiers.map((tier) => (
            <div
              key={tier.id}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${tier.accent}`}>
                    {tier.label}
                  </span>
                  <code className="text-[10px] text-slate-500 bg-white/5 px-1 rounded">
                    {tier.building}
                  </code>
                </div>
                <div className="text-[11px] font-mono text-slate-300">
                  base <span className="text-cyan-300">{tier.base}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  +<span className="text-cyan-300">{tier.perLevel}</span>/ур.
                </div>
              </div>
              <p className="text-[10px] text-slate-500">{tier.hint}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 px-3 py-2 rounded-md border border-white/5 bg-white/[0.03] text-[11px] text-slate-400">
          Космопорт (орбита): +<span className="text-cyan-300 font-mono">{SPACEPORT_PER_LEVEL}</span> ед./ур. к орбитальному буферу.
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Категории ресурсов
        </h3>
        <p className="text-xs text-slate-400 mb-2">
          Каждый элемент таблицы Менделеева имеет категорию, влияющую на приоритет
          резерва склада и тип склада (ore/processed/highTech).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_LABELS) as ElementCategory[]).map((cat) => (
            <Badge
              key={cat}
              variant="outline"
              className="text-[10px] h-5 px-2 border-white/15 text-slate-300 bg-white/5"
            >
              {CATEGORY_LABELS[cat]}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Специализация склада
        </h3>
        <ul className="text-xs text-slate-300 list-disc list-inside space-y-1">
          <li>Универсальный (×1.0) — стартовый профиль.</li>
          <li>Рудный (+25%) — для добывающих колоний.</li>
          <li>Металлургический (+20%) — для плавильных планет.</li>
          <li>Газовый (+20%) — для атмосферных экстракторов.</li>
          <li>Компонентный (+15%) — для высокотехнологичных миров.</li>
        </ul>
      </section>
    </div>
  );
}

// ============================================================================
// ВКЛАДКА: ФЛОТ
// ============================================================================

function FleetTab() {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Корпуса кораблей (4 в MVP)
        </h3>
        <p className="text-xs text-slate-400 mb-2">
          Тяжёлые корпуса (Cruiser/Battleship/Flagship) — Etap 4. Требования
          к инженерии и верфи указаны в таблице.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-white/10">
                <th className="text-left py-1.5 pr-3 font-medium">Корпус</th>
                <th className="text-right py-1.5 px-2 font-medium">HS</th>
                <th className="text-right py-1.5 px-2 font-medium">HP</th>
                <th className="text-right py-1.5 px-2 font-medium">Масса</th>
                <th className="text-right py-1.5 px-2 font-medium">Слоты</th>
                <th className="text-right py-1.5 pl-2 font-medium">Верфь</th>
              </tr>
            </thead>
            <tbody>
              {HULLS.map((h) => (
                <tr key={h.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-1.5 pr-3 text-slate-200 font-medium">{h.name}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-cyan-300">{h.totalHS}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-emerald-300">{h.baseHP}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-amber-300">{h.baseMass}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                    {h.weaponSlots}/{h.engineSlots}/{h.systemSlots}/{h.defenseSlots}
                  </td>
                  <td className="py-1.5 pl-2 text-right font-mono text-slate-300">
                    L{h.requiredShipyardLevel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Колонка «Слоты»: оружие/двигатели/системы/защита. HS = Hull Space (общая вместимость модулей).
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-cyan-200 mb-2">
          Топливо и движение
        </h3>
        <ul className="text-xs text-slate-300 list-disc list-inside space-y-1">
          <li>
            Типы топлива: {ALL_FUEL_TYPES.map((ft) => FUEL_TYPE_LABELS[ft] ?? ft).join(' · ')}.
          </li>
          <li>
            1 ед. элемента = 1 ед. топлива (упрощение MVP). Etap 4 может усложнить пропорции.
          </li>
          <li>
            Хим. топливо и водород делят один бак <code className="text-cyan-300 bg-white/5 px-1 rounded">H</code> на планете.
          </li>
          <li>
            Приказы флота: move / patrol / colonize / attack / defend. Приказ defend — мгновенный, без движения.
          </li>
          <li>
            Движение: один тик — один шаг маршрута. При старте движения эмитится <code className="text-cyan-300 bg-white/5 px-1 rounded">fleet:movement-started</code>.
          </li>
          <li>
            Колонизация: флот должен достичь системы с неколонизированной планетой — приказ срабатывает в конце маршрута.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ============================================================================
// ВКЛАДКА: ЗДАНИЯ
// ============================================================================

function BuildingsTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Полный каталог зданий (data-driven из <code className="text-cyan-300 bg-white/5 px-1 rounded">src/data/buildings/*.json</code>).
        Стоимость — за 1 уровень. Энергия: «−N» — потребление, «+10» — выход (для энергетических).
        Бейдж «требует технологию» означает, что постройка доступна только после изучения указанной технологии.
      </p>
      {BUILDINGS.map((b) => {
        const costEntries = Object.entries(b.costPerLevel);
        // R-BLD-MOD: data-driven — бейдж «требует технологию» берётся из requiresTechs.
        const techReqs = b.requiresTechs ?? [];
        const hasTechReq = techReqs.length > 0;
        // R-BLD-MOD: bonuses (building-sourced + tech-sourced) для отображения.
        const bonuses = b.bonuses ?? [];
        return (
          <div
            key={b.id}
            className="rounded-md border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold text-cyan-200">{b.name}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1 text-slate-400 border-white/20">
                  {CATEGORY_NAMES[b.category] ?? b.category}
                </Badge>
                {hasTechReq && (
                  <Badge className="text-[10px] h-4 px-1 bg-amber-900/40 text-amber-300 border border-amber-700/40">
                    требует технологию
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                {b.layer.map((layer) => (
                  <span key={layer} className="bg-white/5 px-1.5 py-0.5 rounded">
                    {LAYER_NAMES[layer] ?? layer}
                  </span>
                ))}
                <span>·</span>
                <span>макс. ур. {b.levels}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
              {b.description}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {b.energyConsumption > 0 ? (
                <span className="text-orange-400 font-mono">−{b.energyConsumption} энерг.</span>
              ) : b.category === 'energy' ? (
                <span className="text-green-400 font-mono">+10 энерг.</span>
              ) : null}
              <span className="text-slate-300 font-mono text-[11px]">
                {costEntries.map(([rid, amt]) => `${rid} ${amt}`).join(' · ')}
              </span>
            </div>
            {/* R-BLD-MOD: список требуемых технологий (data-driven) */}
            {hasTechReq && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="text-amber-400/80">Требуется:</span>
                {techReqs.map((req) => {
                  const tech = TECH_MAP.get(req.techId);
                  return (
                    <span
                      key={req.techId}
                      className="bg-amber-950/40 border border-amber-800/40 text-amber-200 px-1.5 py-0.5 rounded"
                    >
                      {tech?.name ?? req.techId} ≥ ур.{req.minLevel}
                    </span>
                  );
                })}
              </div>
            )}
            {/* R-BLD-MOD: список бонусов (building-sourced + tech-sourced) */}
            {bonuses.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="text-emerald-400/80">Бонусы:</span>
                {bonuses.map((bonus, i) => {
                  const op = bonus.operation === 'add' ? '+' : '×';
                  const lvl = bonus.perLevel
                    ? '/ур.зд.'
                    : bonus.sourceTech
                      ? (bonus.perTechLevel ? `/ур.тех.` : ` (фикс.)`)
                      : '';
                  const src = bonus.sourceTech
                    ? `тех. ${TECH_MAP.get(bonus.sourceTech)?.name ?? bonus.sourceTech}${bonus.minTechLevel ? ` ≥L${bonus.minTechLevel}` : ''}`
                    : bonus.source ?? '—';
                  return (
                    <span
                      key={i}
                      className="bg-emerald-950/40 border border-emerald-800/40 text-emerald-200 px-1.5 py-0.5 rounded font-mono"
                    >
                      {bonus.target} {op} {bonus.value}{lvl} ← {src}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
