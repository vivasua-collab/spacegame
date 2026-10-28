'use client';

/**
 * GAME-RECOVERY-01 (Issue #22): React-хук записи recovery-checkpoint'ов.
 *
 * Монтируется один раз в корне (src/app/page.tsx). Правила записи:
 *  1. ЗАМЕНА сессии (new game / загрузка серверного сейва / восстановление)
 *     → НЕМЕДЛЕННЫЙ checkpoint (новая запись атомарно заменяет старую;
 *     отмена New Game ничего не пишет/не удаляет — состояние не менялось).
 *     Триггер — store.sessionVersion (монотонный счётчик замен сессии;
 *     follow-up аудита 2026-10-28): НЕ galaxy.id — при загрузке сейва,
 *     созданного из ТОЙ ЖЕ галактики, id не менялся и немедленная запись
 *     пропускалась (checkpoint обновлялся только периодическим таймером —
 *     до 30 с спустя; F5 в этом окне восстанавливал устаревшее состояние).
 *     Счётчик инкрементируется store'ом ровно при успешной замене сессии
 *     (newGame / успешный loadGame / успешный restoreFromCheckpoint) —
 *     включая ту же галактику с другим tick/состоянием.
 *  2. Активная сессия → периодическая запись каждые RECOVERY_INTERVAL_MS
 *     (стабильный setInterval — не пересоздаётся на тиках/рендерах).
 *  3. Переход в меню («В главное меню», #21) → свежий checkpoint
 *     приостановленной сессии (в эффекте-очистке по isInitialized).
 *  4. document.visibilitychange → hidden → попытка свежего checkpoint
 *     (не полагаемся на async во время закрытия — периодичность обязательна).
 *
 * Параллельность: все записи идут через RecoveryService (не более одной
 * полной сериализации; ровно один свежий снимок в очередь при пропуске).
 * Ошибки: console.warn + ненавязчивый toast ОДИН раз за сессию (квота и
 * пр.) — симуляция не останавливается, ложного успеха нет.
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/game-store';
import {
  getRecoveryService,
  RECOVERY_INTERVAL_MS,
  RecoveryError,
} from '@/lib/game-recovery';
import { toast } from '@/hooks/use-toast';

export function useGameRecovery(): void {
  const isInitialized = useGameStore((s) => s.isInitialized);
  // Монотонный счётчик замен сессии (см. комментарий модуля): меняется
  // ТОЛЬКО при успешной замене сессии — не на тиках/рендерах.
  const sessionVersion = useGameStore((s) => s.sessionVersion);
  const warnedOnce = useRef(false);

  // Замена сессии → немедленный checkpoint (замена старой записи).
  // ВАЖНО: срабатывает и при загрузке серверного сейва из той же галактики
  // (galaxy.id совпадает) — раньше этот случай был слепой зоной galaxyId.
  useEffect(() => {
    if (!sessionVersion) return; // сессий ещё не было
    const state = useGameStore.getState().gameState;
    if (!state) return;
    getRecoveryService()
      .writeCheckpoint(state)
      .catch((e) => {
        console.warn('[recovery] checkpoint после замены сессии не записан:', e);
      });
  }, [sessionVersion]);

  // Периодическая запись ТОЛЬКО активной сессии (меню не тикает — но
  // приостановленная сессия уже покрыта переходом в меню; после возврата
  // в игру интервал стартует заново).
  useEffect(() => {
    if (!isInitialized) return;
    const id = setInterval(() => {
      const state = useGameStore.getState().gameState;
      if (!state) return;
      getRecoveryService()
        .writeCheckpoint(state)
        .catch((e) => {
          console.warn('[recovery] периодический checkpoint не записан:', e);
          // Ненавязчивое предупреждение — один раз за сессию (квота и пр.):
          // игра продолжает работать, прошлый пригодный checkpoint цел.
          if (!warnedOnce.current) {
            warnedOnce.current = true;
            const msg = e instanceof RecoveryError && e.reason === 'quota'
              ? 'Локальный autosave: не хватает места (квота). Прошлый checkpoint цел.'
              : 'Локальный autosave временно недоступен (см. консоль).';
            toast({
              title: 'Recovery-checkpoint',
              description: msg,
            });
          }
        });
    }, RECOVERY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isInitialized]);

  // Переход в меню / unmount активной сессии → свежий checkpoint
  // приостановленной сессии (Issue #22: «перед переходом в меню… обеспечить
  // свежий checkpoint»).
  useEffect(() => {
    if (!isInitialized) return;
    return () => {
      const state = useGameStore.getState().gameState;
      if (!state) return;
      // best-effort: страница может закрываться — периодическая запись
      // уже покрывает интервалом; здесь лишь «свежее» состояние.
      void getRecoveryService()
        .writeCheckpoint(state)
        .catch(() => undefined);
    };
  }, [isInitialized]);

  // visibilitychange → hidden → попытка свежего checkpoint.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      const state = useGameStore.getState().gameState;
      if (!state) return;
      void getRecoveryService()
        .writeCheckpoint(state)
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);
}
