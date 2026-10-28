/**
 * F1-фикстура, non-production (аналог tests/): единственные в этом дереве
 * registerQuery/query/unregisterQuery для 'fx:f1-q'. Не должны классифицировать
 * query как зарегистрированный в production (F1 follow-up Issue #17).
 */
import { FxRegistry } from './fx-registry';

const registry = new FxRegistry();

registry.registerQuery('fx:f1-q', () => 'test-only');
registry.query<string>('fx:f1-q');
registry.unregisterQuery('fx:f1-q');
