/**
 * Неподдерживаемая форма: имя события в переменной. Анализатор фиксирует
 * unresolved-форму (recognized=true) и НЕ создаёт факт публикации.
 * Включается в анализ только отдельным сценарием теста 12.
 */
import { gameBus } from './fx-bus';

const dynamicEvent = ('fx:' + 'future') as string;

gameBus.emit(dynamicEvent);
