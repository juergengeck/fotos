import { describe, expect, it } from 'vitest';

import { shouldExposeFotosDebugApi } from './fotosLiveDiagnostics';

describe('shouldExposeFotosDebugApi', () => {
    it('always exposes the debug API in dev', () => {
        expect(shouldExposeFotosDebugApi(true, '')).toBe(true);
    });

    it('keeps the debug API off in production by default', () => {
        expect(shouldExposeFotosDebugApi(false, '')).toBe(false);
    });

    it('allows the production debug API via fotosDebug query params', () => {
        expect(shouldExposeFotosDebugApi(false, '?fotosDebug=1')).toBe(true);
        expect(shouldExposeFotosDebugApi(false, '?fotosDebug=true')).toBe(true);
        expect(shouldExposeFotosDebugApi(false, '?fotosDebug=yes')).toBe(true);
    });
});
