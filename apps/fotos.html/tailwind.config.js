import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
        path.join(path.dirname(require.resolve('@vger/vger.ui')), '**/*.{js,mjs,ts,tsx}'),
    ],
    theme: {
        extend: {}
    },
    plugins: []
};
