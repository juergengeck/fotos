interface BreadcrumbItem {
    key: string;
    label: string;
    onClick?: () => void;
}

interface GalleryBreadcrumbsProps {
    items: BreadcrumbItem[];
    summary?: string;
}

export function GalleryBreadcrumbs({ items, summary }: GalleryBreadcrumbsProps) {
    return (
        <div className="sticky top-0 z-20 border-b border-white/10 bg-[#111]/82 backdrop-blur-md">
            <div className="flex min-h-11 items-center gap-3 px-3 py-2">
                <nav
                    aria-label="Breadcrumb"
                    className="hide-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[11px] uppercase tracking-[0.18em]"
                >
                    {items.map((item, index) => {
                        const isCurrent = index === items.length - 1;
                        const content = (
                            <span className={`block max-w-[14rem] truncate ${isCurrent ? 'text-white/82' : 'text-white/42'}`}>
                                {item.label}
                            </span>
                        );

                        return (
                            <div key={item.key} className="flex items-center gap-1 shrink-0">
                                {index > 0 && (
                                    <span className="text-white/18" aria-hidden="true">
                                        /
                                    </span>
                                )}
                                {item.onClick ? (
                                    <button
                                        type="button"
                                        onClick={item.onClick}
                                        className="rounded-full px-1.5 py-0.5 transition-colors hover:bg-white/6 hover:text-white"
                                    >
                                        {content}
                                    </button>
                                ) : (
                                    <span className="px-1.5 py-0.5">{content}</span>
                                )}
                            </div>
                        );
                    })}
                </nav>
                {summary ? (
                    <div className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-white/30">
                        {summary}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
