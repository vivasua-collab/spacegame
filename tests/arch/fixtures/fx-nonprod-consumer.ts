/**
 * Test-only потребитель (аналог tests/): подписывается на fx:ping, но живёт в
 * non-production наборе — НЕ должен маскировать отсутствие production-потребителя.
 */
import { gameBus } from './fx-bus';

gameBus.on('fx:ping', () => undefined);
