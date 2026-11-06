import {describe, expect, it} from 'vitest';

import {resolveFotosApiTarget} from './fotosApiTarget.js';

describe('resolveFotosApiTarget', () => {
    it('never falls back when an explicit browser client is unknown', () => {
        expect(resolveFotosApiTarget({
            explicitClientId: 'missing-client',
            activeClientId: 'active-client',
            clientIds: ['active-client'],
            fallbackClientId: 'active-client',
        })).toEqual({
            clientId: null,
            explicitClientMissing: true,
        });
    });

    it('resolves a known explicit client exactly', () => {
        expect(resolveFotosApiTarget({
            explicitClientId: 'alice-client',
            activeClientId: 'bob-client',
            clientIds: ['alice-client', 'bob-client'],
            fallbackClientId: 'bob-client',
        })).toEqual({
            clientId: 'alice-client',
            explicitClientMissing: false,
        });
    });
});
