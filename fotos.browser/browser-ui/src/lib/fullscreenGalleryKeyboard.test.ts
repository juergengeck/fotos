// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleFullscreenGalleryKey } from './fullscreenGalleryKeyboard.js';

let scroller: HTMLDivElement;
let cards: HTMLButtonElement[];

beforeEach(() => {
  scroller = document.createElement('div');
  scroller.innerHTML = '<main data-fullscreen-gallery="true"><section data-gallery-day="today"><button data-photo-index="0">one</button><button data-photo-index="1">two</button><button data-photo-index="2">three</button></section></main>';
  document.body.append(scroller);
  cards = Array.from(scroller.querySelectorAll('button'));
  scroller.getBoundingClientRect = () => ({ top: 100, bottom: 300 }) as DOMRect;
  cards.forEach((card, index) => {
    card.getBoundingClientRect = () => ({ top: index * 200, bottom: (index + 1) * 200 }) as DOMRect;
    card.scrollIntoView = vi.fn();
  });
});

afterEach(() => scroller.remove());

function press(key: string, target: HTMLElement = scroller, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  target.addEventListener('keydown', event => handleFullscreenGalleryKey(event as KeyboardEvent, scroller), { once: true });
  target.dispatchEvent(event);
  return event;
}

it('starts at visible media and moves in both directions without wrapping', () => {
  expect(press('ArrowDown').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(cards[0]);
  press('ArrowRight');
  expect(document.activeElement).toBe(cards[1]);
  press('ArrowDown');
  press('ArrowDown');
  expect(document.activeElement).toBe(cards[2]);
  press('ArrowLeft');
  press('ArrowUp');
  press('ArrowUp');
  expect(document.activeElement).toBe(cards[0]);
  expect(cards[0].scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
});

it('uses the current viewport when no media is focused', () => {
  scroller.getBoundingClientRect = () => ({ top: 250, bottom: 450 }) as DOMRect;
  press('ArrowUp');
  expect(document.activeElement).toBe(cards[1]);
});

it('leaves editing, modified shortcuts, and native Enter activation alone', () => {
  const input = document.createElement('input');
  scroller.append(input);
  input.focus();
  expect(press('ArrowDown', input).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(press('ArrowDown', scroller, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(press('Enter').defaultPrevented).toBe(false);
  const prevented = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  prevented.preventDefault();
  handleFullscreenGalleryKey(prevented, scroller);
  expect(document.activeElement).toBe(input);
});
