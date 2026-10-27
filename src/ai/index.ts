/**
 * Этап 3а (R-41): AI-фракции — публичный экспорт.
 *
 * Границы 3а: каркас (типы, валидация, world model, perception, инертная
 * intent-очередь, lifecycle модуля). Исполнение игровых действий,
 * GOAP/Utility, сериализация AI-состояния — этап 3б (после приёмки 3а).
 */

export { AIModule, type AIStateQueryResult } from './ai-module';
export { buildWorldModel, buildPerception } from './perception';
export {
  AI_STATE_VERSION,
  AI_DIFFICULTIES,
  AI_DIFFICULTY_UPDATE_INTERVAL,
  DEFAULT_AI_CONFIG,
  DEFAULT_MAX_INTENTS,
  validateAIConfig,
  validateAIIntent,
  createIntentQueue,
  enqueueIntent,
  type AIDifficulty,
  type AIConfig,
  type AIIntent,
  type AIIntentAction,
  type AIIntentStatus,
  type AIIntentQueue,
  type AIWorldModel,
  type AIPerceptionSnapshot,
  type AIControllerState,
  type AIControllerSummary,
} from './types';
