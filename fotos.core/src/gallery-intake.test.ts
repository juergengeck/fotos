import {describe, expect, it} from 'vitest';
import {
    getGallerySurfaceProfile,
    getGallerySourceCapabilities,
    planGalleryIntake,
} from './gallery-intake.js';

describe('gallery intake policy', () => {
    it('treats one.fotos filesystem intake as authoritative ingest', () => {
        const plan = planGalleryIntake('one.fotos', 'filesystem');

        expect(plan.supported).toBe(true);
        expect(plan.mode).toBe('attach-library');
        expect(plan.writesSidecars).toBe(true);
        expect(plan.faceEnrichment).toBe('local');
        expect(plan.actionLabel).toBe('ingest library');
    });

    it('treats desktop browser filesystem intake as an attach flow', () => {
        const profile = getGallerySurfaceProfile('fotos-browser-desktop');
        const plan = planGalleryIntake(profile.surface, profile.defaultSource);

        expect(profile.role).toBe('attach');
        expect(plan.supported).toBe(true);
        expect(plan.mode).toBe('attach-library');
        expect(plan.actionLabel).toBe('Open photo folder');
    });

    it('treats mobile browser intake as lightweight selection capture', () => {
        const plan = planGalleryIntake('fotos-browser-mobile', 'photo-library');

        expect(plan.supported).toBe(true);
        expect(plan.mode).toBe('capture-selection');
        expect(plan.writesSidecars).toBe(false);
        expect(plan.faceEnrichment).toBe('remote');
    });

    it('marks lama.fire as consumer-only', () => {
        const plan = planGalleryIntake('lama-fire', 'remote-manifest');

        expect(plan.supported).toBe(true);
        expect(plan.mode).toBe('consume-feed');
        expect(plan.faceEnrichment).toBe('none');
    });

    it('rejects filesystem ingest for lama.fire', () => {
        const plan = planGalleryIntake('lama-fire', 'filesystem');

        expect(plan.supported).toBe(false);
        expect(plan.reason).toContain('consumer-only');
    });

    it('describes shared-files as non-writable capture input', () => {
        const capabilities = getGallerySourceCapabilities('shared-files');

        expect(capabilities.canReadOriginals).toBe(true);
        expect(capabilities.canWriteMetadataInPlace).toBe(false);
        expect(capabilities.portable).toBe(false);
    });
});
