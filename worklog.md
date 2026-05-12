---
Task ID: 1
Agent: main
Task: Design and implement modular architecture with typed event bus for SpaceGame

Work Log:
- Analyzed existing project structure (570-line monolithic store, untyped EventBus, disconnected GameLoop)
- Read all key files: event-bus.ts, game-loop.ts, game-store.ts, economy/engine.ts, types.ts, page.tsx
- Created comprehensive architecture document at docs/architecture/modular-bus.md (2050 lines, Russian)
- Implemented TypedEventBus with priorities, event replay, defer/flush (src/core/typed-event-bus.ts)
- Implemented typed event map with 60+ events across 10 modules (src/core/events.ts)
- Implemented module contract types: IGameModule, ModuleManifest, lifecycle (src/core/module-types.ts)
- Implemented ModuleRegistry with topological sort for dependency resolution (src/core/module-registry.ts)
- Implemented GameMediator as central orchestrator (src/core/game-mediator.ts)
- Updated GameLoop to work with bus and registry (src/core/game-loop.ts)
- Created legacy adapter for old EventBus (src/core/event-bus.ts) — backward compatible
- Created EconomyModule as first modular citizen (src/economy/economy-module.ts)
- Created GalaxyModule as second modular citizen (src/galaxy/galaxy-module.ts)
- Updated game-store.ts to initialize modules through GameMediator
- Created unified core index.ts with all exports
- All lint checks pass, no new TypeScript errors

Stage Summary:
- Core infrastructure complete: TypedEventBus, ModuleRegistry, GameMediator, IGameModule
- Two modules implemented: EconomyModule, GalaxyModule
- Full event catalog: 60+ typed events for current + future modules
- Legacy backward compatibility maintained (old EventBus still works)
- Architecture document provides migration path and future module template
- Key design: modules communicate ONLY through typed bus + query system (no direct imports)
