import '@refinio/one.core/lib/system/load-nodejs.js';
import {describe, expect, it} from 'vitest';
import {createFotosRuntimeModules} from './fotos-runtime-modules';

describe('Fotos runtime module graph', () => {
    it('provides every required contract of the real retained runtime modules', () => {
        const {modules} = createFotosRuntimeModules('wss://comm10.dev.refinio.one', 'https://fotos.one');
        const supplied = new Set(['OperationRegistry', 'OneCore', 'ExportPlan', 'SettingsPlan',
            'SecretsPlan', 'DevicesPlan', 'SyncRules', 'StoryFactory', 'PostStoreImportBatch']);
        for (const module of modules) {
            for (const supply of (module.constructor as any).supplies ?? []) {
                supplied.add(supply.targetType);
            }
        }
        const missing = modules.flatMap(module =>
            ((module.constructor as any).demands ?? [])
                .filter((demand: any) => demand.required && !supplied.has(demand.targetType))
                .map((demand: any) => `${module.name}: ${demand.targetType}`));
        expect(missing).toEqual([]);
    });
});
