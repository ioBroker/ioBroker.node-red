import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://techblog.skeepers.io/create-a-web-component-from-a-react-component-bbe7c5f85ee6
export default defineConfig({
    define: {
        'process.env': {
            NODE_ENV: 'production',
        },
    },
    plugins: [react()],

    // 👇 Insert these lines
    build: {
        lib: {
            entry: './src/index.tsx',
            name: 'iobrokerSelectId',
            fileName: format => `iobrokerSelectId.${format}.js`,
        },
        target: 'esnext',
    },
});
