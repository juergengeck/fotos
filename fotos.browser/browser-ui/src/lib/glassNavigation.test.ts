import {describe, expect, it} from 'vitest';
import {buildGlassViewUrl, readGlassView} from './glassNavigation';

describe('glass navigation', () => {
    it('opens existing settings, sharing, photo and invitation links', () => {
        expect(readGlassView('/', '?task=settings')).toBe('profile');
        expect(readGlassView('/', '?task=settings&view=gallery')).toBe('gallery');
        expect(readGlassView('/', '?task=sharing&view=albums')).toBe('gallery');
        expect(readGlassView('/', '?photo=hash')).toBe('gallery');
        expect(readGlassView('/invites/inviteDevice', '')).toBe('profile');
        expect(readGlassView('/', '?share=1')).toBe('gallery');
    });
    it('restores destination links and defaults to home', () => {
        expect(readGlassView('/', '?view=favorites&photo=hash')).toBe('favorites');
        expect(readGlassView('/', '?view=albums')).toBe('albums');
        expect(readGlassView('/', '?view=unknown')).toBe('home');
    });
    it('removes stale photo and album filters while preserving invitation and diagnostic parameters', () => {
        const url = buildGlassViewUrl('http://localhost/?photo=a&album=b&task=sharing&fotosShare=invite&fotosDebug=1', 'profile');
        expect(url.searchParams.get('task')).toBe('settings');
        expect(url.searchParams.has('photo')).toBe(false);
        expect(url.searchParams.has('album')).toBe(false);
        expect(url.searchParams.get('fotosShare')).toBe('invite');
        expect(url.searchParams.get('fotosDebug')).toBe('1');
    });
    it('returns to home from a consumed device invitation route', () => {
        const url = buildGlassViewUrl('http://localhost/invites/inviteDevice?view=profile&task=settings', 'home');
        expect(url.pathname + url.search).toBe('/');
    });
});
