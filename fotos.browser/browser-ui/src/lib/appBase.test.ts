import {describe, expect, it} from 'vitest';
import {appPath, appPathname} from './appBase';
import {readGlassView, buildGlassViewUrl} from './glassNavigation';

describe('subdirectory deployment', () => {
    it('builds assets within the deployment prefix', () => {
        expect(appPath('/cam.svg', '/konrad/')).toBe('/konrad/cam.svg');
        expect(appPath('fotos-id', '/konrad/')).toBe('/konrad/fotos-id');
        expect(appPath('version.json', '/')).toBe('/version.json');
    });
    it('normalizes only complete path prefixes', () => {
        expect(appPathname('/konrad/', '/konrad/')).toBe('/');
        expect(appPathname('/konrad/invites/inviteDevice', '/konrad/')).toBe('/invites/inviteDevice');
        expect(appPathname('/konrad-other/', '/konrad/')).toBe('/konrad-other/');
    });
    it('opens the home screen and returns home within Konrad', () => {
        expect(readGlassView('/konrad/', '', '/konrad/')).toBe('home');
        expect(readGlassView('/konrad/invites/inviteDevice', '', '/konrad/')).toBe('profile');
        expect(buildGlassViewUrl('https://fotos.one/konrad/?view=albums', 'home', '/konrad/').href).toBe('https://fotos.one/konrad/');
    });
});
