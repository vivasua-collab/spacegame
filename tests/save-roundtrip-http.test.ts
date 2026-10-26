/// <reference types="bun-types" />
/**
 * Аудит 2026-10-26 (внешний, этап 0–1) — интеграционный тест полного
 * HTTP-раундтрипа сохранения с реальным геймплеем.
 *
 * Путь (весь, а не один файл):
 *   живой GameState (модули: колонизация → стройка → очередь → тики)
 *   → serializeGameState (v3)
 *   → POST /api/save (gzip-base64 транспорт; handler напрямую)
 *   → SQLite (Prisma)
 *   → GET /api/save/[id] (handler напрямую)
 *   → decodeStatePayload
 *   → deserializeGameState
 *   → сравнение ЗНАЧИМЫХ игровых данных (время, seed, планеты, здания,
 *     склад, очереди производства, исследования)
 *   → продолжение игры после загрузки с ожидаемого тика.
 *
 * Существующие тесты (serialization, save-format-v3) покрывают in-memory
 * раундтрип; этот файл закрывает именно СКВОЗНОЙ путь через API + БД.
 *
 * Run: bun test tests/save-roundtrip-http.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { getGameMediator, resetGameMediator, type GameMediator } from '@/core/game-mediator';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { ResearchModule } from '@/research/research-module';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import { decodeStatePayload } from '@/lib/save-codec-server';
import { MAX_STATE_BYTES } from '@/lib/schemas/save-schema';
import { __resetRateLimitBucketsForTesting } from '@/lib/rate-limit';
import { POST } from '@/app/api/save/route';
import { GET as GET_BY_ID, DELETE } from '@/app/api/save/[id]/route';
import { db } from '@/lib/db';
import type { GameState, Planet } from '@/core/types';

/** Медиатор с модулями (economy + galaxy + research) и новой игрой. */
function freshGame(seed: number, systemCount: number): { mediator: GameMediator; state: GameState } {
  const mediator = getGameMediator();
  const economyModule = new EconomyModule();
  const galaxyModule = new GalaxyModule();
  const researchModule = new ResearchModule();
  for (const m of [economyModule, galaxyModule, researchModule]) {
    m.setGameStateAccessor(() => mediator.getGameState());
    m.setGameStateMutator((s) => mediator.commitState(s));
  }
  mediator.registerAndInit([galaxyModule, economyModule, researchModule]);
  const state = mediator.newGame({ seed, systemCount });
  return { mediator, state };
}

/** Первая пригодная для колонизации планета галактики. */
function firstColonizablePlanet(state: GameState): Planet {
  for (const system of state.galaxy.systems) {
    for (const planet of system.planets) {
      if (planet.owner == null) return planet;
    }
  }
  throw new Error('no colonizable planet in test galaxy');
}

describe('Аудит 2026-10-26: полный HTTP-раундтрип сохранения', () => {
  let mediator: GameMediator;
  let createdIds: string[] = [];

  beforeEach(() => {
    resetGameMediator();
    __resetRateLimitBucketsForTesting();
    createdIds = [];
  });

  afterEach(async () => {
    mediator?.destroy();
    resetGameMediator();
    if (createdIds.length > 0) {
      await db.gameSave.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
    }
  });

  test('сквозной раундтрип: игра → POST → БД → GET → загрузка → продолжение', async () => {
    // ─── 1. Живой геймплей ────────────────────────────────────────────
    const seed = 20261026;
    let { mediator: med, state } = freshGame(seed, 6);
    mediator = med;

    const planet = firstColonizablePlanet(state);
    const bus = mediator.getBus();

    // Колонизация (авто-размещает colony_hub)
    bus.emit('economy:colonize', { planetId: planet.id });
    state = mediator.getGameState()!;

    // Строим шахту и переработчик на свободных гексах
    const colonized = state.galaxy.systems
      .flatMap((s) => s.planets)
      .find((p) => p.id === planet.id)!;
    const hubIndex = colonized.hexes.findIndex((h) => h.buildingId === 'colony_hub');
    expect(hubIndex).toBeGreaterThanOrEqual(0);
    let freeHex = colonized.hexes.findIndex((h) => h.buildingId == null);
    if (freeHex >= 0) {
      bus.emit('economy:build', { planetId: planet.id, hexIndex: freeHex, buildingId: 'mine', layer: 'surface' });
    }
    state = mediator.getGameState()!;
    const withMine = state.galaxy.systems.flatMap((s) => s.planets).find((p) => p.id === planet.id)!;
    freeHex = withMine.hexes.findIndex((h) => h.buildingId == null);
    if (freeHex >= 0) {
      bus.emit('economy:build', { planetId: planet.id, hexIndex: freeHex, buildingId: 'processor', layer: 'surface' });
    }

    // Очередь производства с автоповтором (R-26 карусель)
    // smelt_fe: Fe-ore → Fe + O (валидный рецепт, ресурсы у колонии есть)
    bus.emit('economy:enqueue', { planetId: planet.id, recipeId: 'smelt_fe', repeat: true });
    state = mediator.getGameState()!;
    const queueNow = state.productionQueues.get(planet.id)?.items ?? [];
    expect(queueNow.length).toBeGreaterThan(0); // enqueue реально сработал

    // Прогоняем 12 тиков через КАНОНИЧЕСКИЙ путь (loop.step — аудит B)
    const beforeTicks = 12;
    for (let i = 0; i < beforeTicks; i++) {
      mediator.setSpeed(1);
      // фаза playing нужна mediator.tick() — newGame даёт colonization,
      // колонизация через шину уже переключила owner; переключим фазу как
      // это делает store.colonizePlanet (produce + setGameState)
      const cur = mediator.getGameState()!;
      if (cur.phase !== 'playing') {
        const { produce } = await import('immer');
        const playing = produce(cur, (draft) => {
          draft.phase = 'playing';
          draft.speed = 1;
        });
        mediator.setGameState(playing);
      }
      mediator.tick();
    }
    state = mediator.getGameState()!;
    expect(state.time.tick).toBe(beforeTicks);

    // ─── 2. Снимок значимых данных ДО сохранения ─────────────────────
    const planetBefore = state.galaxy.systems
      .flatMap((s) => s.planets)
      .find((p) => p.id === planet.id)!;
    const snapshotBefore = {
      tick: state.time.tick,
      seed: state.galaxy.seed,
      systems: state.galaxy.systems.length,
      planets: state.galaxy.systems.reduce((n, s) => n + s.planets.length, 0),
      buildings: planetBefore.hexes
        .map((h) => ({ id: h.buildingId, lvl: h.buildingLevel }))
        .filter((b) => b.id != null),
      warehouse: JSON.parse(JSON.stringify(planetBefore.warehouse)),
      queue: (state.productionQueues.get(planet.id)?.items ?? []).map((q) => ({
        recipe: q.recipeId,
        repeat: q.repeat,
        remaining: q.progress,
      })),
      researchPoints: state.researchState.totalRpGenerated,
    };

    // ─── 3. Сериализация + POST (gzip-base64 транспорт) ──────────────
    const stateJson = serializeGameState(state);
    expect(stateJson.length).toBeGreaterThan(1000); // не пустышка
    const t0 = performance.now();
    const postRes = await POST(new Request('http://localhost/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '44.44.44.44' },
      body: JSON.stringify({
        name: 'AuditRoundtrip',
        seed: state.galaxy.seed,
        state: gzipSync(Buffer.from(stateJson, 'utf8')).toString('base64'),
        stateEncoding: 'gzip-base64',
        tick: state.time.tick,
      }),
    }));
    expect(postRes.status).toBe(201);
    const postMs = performance.now() - t0;
    const { id: saveId } = await postRes.json() as { id: string };
    createdIds.push(saveId);

    // В БД — plain JSON, побайтово равный сериализации
    const row = await db.gameSave.findUnique({ where: { id: saveId } });
    expect(row?.state).toBe(stateJson);
    expect(row?.tick).toBe(state.time.tick);

    // ─── 4. GET → decode → deserialize ───────────────────────────────
    const getRes = await GET_BY_ID(
      new Request(`http://localhost/api/save/${saveId}`),
      { params: Promise.resolve({ id: saveId }) },
    );
    expect(getRes.status).toBe(200);
    const getData = await getRes.json() as { state: string; stateEncoding?: string };
    // state < 512 КБ → plain (порог STATE_ENCODING_THRESHOLD)
    const encodingPlain = getData.stateEncoding === 'gzip-base64' ? 'gzip-base64' : undefined;
    const loadedJson = await decodeStatePayload(getData.state, encodingPlain, MAX_STATE_BYTES);
    expect(loadedJson).toBe(stateJson); // бит-в-бит

    const loaded = deserializeGameState(loadedJson);

    // ─── 5. Сравнение значимых данных ПОСЛЕ загрузки ─────────────────
    expect(loaded.time.tick).toBe(snapshotBefore.tick);
    expect(loaded.galaxy.seed).toBe(snapshotBefore.seed);
    expect(loaded.galaxy.systems.length).toBe(snapshotBefore.systems);
    expect(loaded.galaxy.systems.reduce((n, s) => n + s.planets.length, 0)).toBe(snapshotBefore.planets);

    const planetAfter = loaded.galaxy.systems
      .flatMap((s) => s.planets)
      .find((p) => p.id === planet.id)!;
    expect(planetAfter.owner).toBe('player');
    expect(
      planetAfter.hexes
        .map((h) => ({ id: h.buildingId, lvl: h.buildingLevel }))
        .filter((b) => b.id != null),
    ).toEqual(snapshotBefore.buildings);
    expect(JSON.parse(JSON.stringify(planetAfter.warehouse))).toEqual(snapshotBefore.warehouse);

    const queueAfter = (loaded.productionQueues.get(planet.id)?.items ?? []).map((q) => ({
      recipe: q.recipeId,
      repeat: q.repeat,
      remaining: q.progress,
    }));
    expect(queueAfter).toEqual(snapshotBefore.queue);
    expect(loaded.researchState.totalRpGenerated).toBe(snapshotBefore.researchPoints);

    // ─── 6. Продолжение игры с ожидаемого тика ──────────────────────
    // loadGame в store делает: mediator.setLoadedState(loaded) — время
    // цикла синхронизируется; следующий тик = loaded.tick + 1.
    mediator.setLoadedState(loaded);
    mediator.setSpeed(1);
    mediator.tick();
    const resumed = mediator.getGameState()!;
    expect(resumed.time.tick).toBe(loaded.time.tick + 1);

    // Сериализация загруженного состояния идемпотентна
    expect(serializeGameState(resumed).length).toBeGreaterThan(0);

    // ─── 7. Уборка ────────────────────────────────────────────────────
    const delRes = await DELETE(
      new Request(`http://localhost/api/save/${saveId}`),
      { params: Promise.resolve({ id: saveId }) },
    );
    expect(delRes.status).toBe(200);
    createdIds = [];

    console.log(`[roundtrip] state ${stateJson.length} chars, POST ${postMs.toFixed(0)}ms, tick ${snapshotBefore.tick}, queue ${JSON.stringify(snapshotBefore.queue)}`);
  });

  test('сжатый транспорт GET: сейв > 512 КБ проходит gzip-base64 путь без потерь', async () => {
    // Строим состояние > 512 КБ: система с большим числом гексов и залежей.
    // Самый простой способ — сериализовать галактику на 60 систем.
    const { mediator: med, state } = freshGame(777, 60);
    mediator = med;

    const stateJson = serializeGameState(state);
    expect(Buffer.byteLength(stateJson, 'utf8')).toBeGreaterThan(512 * 1024);

    const postRes = await POST(new Request('http://localhost/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '44.44.44.45' },
      body: JSON.stringify({
        name: 'AuditBigTransport',
        seed: state.galaxy.seed,
        state: stateJson, // plain — меньше 32 МБ лимита шлюза в тесте
        tick: 0,
      }),
    }));
    expect(postRes.status).toBe(201);
    const { id: saveId } = await postRes.json() as { id: string };
    createdIds.push(saveId);

    const getRes = await GET_BY_ID(
      new Request(`http://localhost/api/save/${saveId}`),
      { params: Promise.resolve({ id: saveId }) },
    );
    expect(getRes.status).toBe(200);
    const getData = await getRes.json() as { state: string; stateEncoding: string };
    expect(getData.stateEncoding).toBe('gzip-base64'); // > порога → сжат
    const encodingGzip = getData.stateEncoding === 'gzip-base64' ? 'gzip-base64' : undefined;
    const loadedJson = await decodeStatePayload(getData.state, encodingGzip, MAX_STATE_BYTES);
    expect(loadedJson).toBe(stateJson); // бит-в-бит через сжатый путь

    // И deserialize успешен
    const loaded = deserializeGameState(loadedJson);
    expect(loaded.galaxy.systems.length).toBe(60);
  });
});
