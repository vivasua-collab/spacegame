# Чекпоинт: Уборка и корректировка — чекпоинты, README-ссылки, docs-синк

**Дата:** 2026-08-31 10:45
**Фаза:** Инфраструктура / документация (вне игровых этапов)
**Статус:** complete

## Контекст

Владелец: «правила чекпоинтов размещены `checkpoints/RULES.md`; при холодном старте агент их не
прочитал и создал файлы с наименованиями, не согласованными с правилами (ошибка тянется с 27-08,
вероятно после переполнения контекста). Необходимо добавить прямую ссылку в README.md, чтобы при
последующих запусках можно было прочитать все связанные документы. В docs отразить все логические
изменения, внесённые сегодня».

План задачи: `plans/2026-08-31-task25-checkpoint-cleanup-docs-sync.md` (Task ID 25).

## Выполненные задачи

- 11 чекпоинтов `audit_YYYY_MM_DD_NN_*.md` переименованы (`git mv`) в формат `ММ_ДД_цель.md`:
  см. таблицу маппинга ниже.
- 26 ссылок на старые имена обновлены в живых документах: README.md (3), docs/STATUS.md (4),
  docs/audit-history.md (1), docs/buildings-verification.md (3), docs/data-driven-architecture.md (3),
  внутри самих переименованных чекпоинтов (12, вкл. self-ref foundation).
  `worklog.md` НЕ переписывался (append-only по правилам) — старые имена из его истории
  разрешаются таблицей ниже.
- README.md: новая секция **«📋 Документы процесса (обязательны к прочтению при старте сессии)»**
  с прямыми ссылками на `checkpoints/RULES.md`, `plans/README.md`, `worklog.md`,
  `checkpoints/ROADMAP.md`, `docs/!listing.md`, `docs/STATUS.md` + порядок чтения при холодном старте.
- README.md: актуализация — «Текущий статус» (Etap 4.1 ✅, 513 тестов, синергия v2, R-SPLIT),
  дерево проекта (+ worklog.md, + plans/, − doc_temp/), «Назначение папок», стек (справочники —
  data-driven JSON), метрики на 2026-08-31 (147 файлов src, 29 docs, 40 чекпоинтов, 513 тестов,
  4 валидатора).
- docs/STATUS.md: сводка (Etap 4.1 ✅ → след. 4.2, 513/513 тестов, 48 warnings, +строка
  «Валидаторы каталогов»), §6 метрики, §7.2 приоритеты (NEXT = Etap 4.2, AI-фракции → BACKLOG,
  +NEXT-2 возврат кросс-типовых правил синергии), история изменений (+5 строк: 08-28 passes 5-9,
  08-31 R-STARS-DATA / R-23 / R-24 / cleanup).
- docs/data-driven-architecture.md: v1.2 — новый **§2.5 Synergy** (R-23/R-24: synergy.json v2,
  типовая модель, 4 активных правила, отложенные кросс-типы), §5 валидаторы (+validate:stars,
  validate:buildings + synergy, «все четыре»).
- docs/!listing.md: дата 2026-08-31, totals (~23 700 строк), актуализация строк/статусов
  20-stars / 30-planets / 40-buildings (63%) / 60-research (✅ MVP, R-SPLIT) /
  data-driven-architecture (v1.2) / STATUS (378).
- Уборка: `doc_temp/` удалён (его README санкционировал удаление после проверки; все 4
  перенесённых файла проверены в docs/), `tool-results/` удалён (незатреканные дампы чтения),
  из .gitignore убрана устаревшая строка `/doc_temp/*.bak` ( `tool-results/` уже был добавлен).
- Проверка: живые документы (README, docs/, checkpoints/, scripts/, src/, tests/) не содержат
  ссылок на старые имена.

## Текущие задачи

- (нет — задача закрыта полностью)

## Проблемы

- Ссылки на старые имена остаются в `worklog.md` (исторические записи Task ID 1-24). Это принято
  осознанно: журнал append-only, переименования фиксируются таблицей ниже и этой записью.

## Следующие шаги

- Etap 4.2 — планетарный каталог (рекомендация Pass 9, STATUS §7.2 NEXT).
- Возврат кросс-типовых правил синергии (mine_processor / warehouse_production) — одна запись
  в `src/data/buildings/synergy.json` (STATUS §7.2 NEXT-2).
- P0-1: Store→mediator sync (см. Pass 1).

## Изменённые файлы

- README.md
- docs/STATUS.md, docs/!listing.md, docs/data-driven-architecture.md
- docs/audit-history.md, docs/buildings-verification.md (правка ссылок)
- .gitignore
- checkpoints/ — 11 переименований + этот файл
- plans/2026-08-31-task25-checkpoint-cleanup-docs-sync.md
- удалены: doc_temp/README.md (git rm), tool-results/ (untracked)

## Таблица маппинга имён (для разрешения ссылок из истории worklog)

| Старое имя (в worklog/истории до 2026-08-31) | Новое имя (по RULES.md) |
|---|---|
| `checkpoints/audit_2026_08_27_01_foundation.md` | `checkpoints/08_27_audit_01_foundation.md` |
| `checkpoints/audit_2026_08_27_02_code_quality.md` | `checkpoints/08_27_audit_02_code_quality.md` |
| `checkpoints/audit_2026_08_27_03_docs_compliance.md` | `checkpoints/08_27_audit_03_docs_compliance.md` |
| `checkpoints/audit_2026_08_27_04_mvp_readiness.md` | `checkpoints/08_27_audit_04_mvp_readiness.md` |
| `checkpoints/audit_2026_08_28_05_ux_fixes.md` | `checkpoints/08_28_audit_05_ux_fixes.md` |
| `checkpoints/audit_2026_08_28_06_research_redesign.md` | `checkpoints/08_28_audit_06_research_redesign.md` |
| `checkpoints/audit_2026_08_28_07_modular_buildings.md` | `checkpoints/08_28_audit_07_modular_buildings.md` |
| `checkpoints/audit_2026_08_28_08_ships_data_driven.md` | `checkpoints/08_28_audit_08_ships_data_driven.md` |
| `checkpoints/audit_2026_08_28_09_post_r_ships_galaxy_eval.md` | `checkpoints/08_28_audit_09_post_r_ships_galaxy_eval.md` |
| `checkpoints/audit_2026_08_31_10_stars_extraction.md` | `checkpoints/08_31_audit_10_stars_extraction.md` |
| `checkpoints/audit_2026_08_31_11_synergy_demolish_split.md` | `checkpoints/08_31_audit_11_synergy_demolish_split.md` |
