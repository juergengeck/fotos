import assert from 'node:assert/strict';
import test from 'node:test';
import {adjacentPhotoId, canShowPhoto} from './navigation.ts';

const photos = [
  {id: 'a', name: 'First', mediaUri: 'file:///first.jpg', mimeType: 'image/jpeg'},
  {id: 'v', name: 'Movie', mediaUri: 'file:///movie.mp4', mimeType: 'video/mp4'},
  {id: 'p', name: 'Preview only', thumbnailUri: 'file:///preview.jpg', mimeType: 'image/jpeg'},
  {id: 'b', name: 'Last', mediaUri: 'file:///last.png', mimeType: 'image/png'},
];

test('manual navigation wraps and retains unavailable media for honest viewing', () => {
  assert.equal(adjacentPhotoId(photos, 'a', -1), 'b');
  assert.equal(adjacentPhotoId(photos, 'b', 1), 'a');
  assert.equal(adjacentPhotoId(photos, 'a', 1), 'v');
});

test('slideshow skips videos and images without originals in both directions', () => {
  assert.equal(adjacentPhotoId(photos, 'a', 1, true), 'b');
  assert.equal(adjacentPhotoId(photos, 'b', -1, true), 'a');
  assert.equal(adjacentPhotoId(photos, 'b', 1, true), 'a');
});

test('removed selection restarts predictably without indexing outside gallery', () => {
  assert.equal(adjacentPhotoId(photos, 'removed', 1, true), 'a');
  assert.equal(adjacentPhotoId(photos, 'removed', -1, true), 'b');
});

test('empty and unsupported galleries cannot advance a slideshow', () => {
  assert.equal(adjacentPhotoId([], 'a', 1), null);
  assert.equal(adjacentPhotoId(photos.slice(1, 3), 'v', 1, true), null);
  assert.equal(adjacentPhotoId([photos[0]], 'a', 1, true), 'a');
});

test('an absent MIME type can be decoded by Image, while non-image content is excluded', () => {
  assert.equal(canShowPhoto({id: 'x', name: 'Unknown', mediaUri: 'file:///asset'}), true);
  assert.equal(canShowPhoto({id: 'x', name: 'Document', mediaUri: 'file:///asset', mimeType: 'application/pdf'}), false);
  assert.equal(canShowPhoto(photos[2]), false);
});
