/**
 * Точка регистрации фикстуры (аналог getMediatorWithModules): порядок вставки
 * [other, fx] при dependencies other→fx даёт initOrder [fx, other].
 */
import { FxModule } from './fx-module';
import { OtherModule } from './fx-other';

const fx = new FxModule();
const other = new OtherModule();

export function initAll(mediatorLike: { registerAndInit(modules: unknown[]): void }): void {
  mediatorLike.registerAndInit([other, fx]);
}
