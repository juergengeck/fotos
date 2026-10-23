/** Navigate Glue's immersive media stream without scrolling the page. */
export function handleFullscreenGalleryKey(event: KeyboardEvent, scroller: HTMLElement): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!direction) return;
    if (event.target instanceof HTMLElement && event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]',
    )) return;

    const cards = Array.from(scroller.querySelectorAll<HTMLButtonElement>(
        '[data-fullscreen-gallery="true"] [data-gallery-day] button[data-photo-index]',
    ));
    if (!cards.length) return;
    const focusedIndex = cards.findIndex(card => card === document.activeElement);
    const viewport = scroller.getBoundingClientRect();
    const visibleIndex = cards.findIndex(card => {
        const rect = card.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    const index = focusedIndex < 0 ? Math.max(0, visibleIndex)
        : Math.max(0, Math.min(cards.length - 1, focusedIndex + direction));
    event.preventDefault();
    cards[index].focus({preventScroll: true});
    cards[index].scrollIntoView({block: 'nearest', inline: 'nearest'});
}
