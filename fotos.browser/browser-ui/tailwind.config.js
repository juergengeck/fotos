export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
        '../../fotos.ui/src/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                surface: {
                    0: 'var(--surface-0)',
                    1: 'var(--surface-1)',
                    2: 'var(--surface-2)',
                    3: 'var(--surface-3)',
                    4: 'var(--surface-4)',
                },
                accent: {
                    DEFAULT: 'var(--accent-primary)',
                    hover: 'var(--accent-primary-hover)',
                },
                danger: {
                    DEFAULT: 'var(--danger)',
                    fg: 'var(--danger-fg)',
                },
            },
            transitionDuration: {
                fast: '150ms',
                normal: '250ms',
            },
        },
    },
    plugins: [],
};
