import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        ignores: ['node_modules/**', 'nodes/**', 'public/**', 'userdata/**', 'src-object-selector/**', 'settings.js'],
    },
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
