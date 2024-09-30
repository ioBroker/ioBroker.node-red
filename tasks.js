const { deleteFoldersRecursive, npmInstall, buildReact } = require('@iobroker/build-tools');
const { copyFileSync, unlinkSync, existsSync} = require('node:fs');

if (existsSync(`${__dirname}/public/iobrokerSelectId.umd.js`)) {
    unlinkSync(`${__dirname}/public/iobrokerSelectId.umd.js`)
}
deleteFoldersRecursive('src-object-selector/dist');
npmInstall('src-object-selector')
    .then(() => buildReact(`${__dirname}/src-object-selector`, { rootDir: __dirname, tsc: true, vite: true }))
    .then(() => {
        copyFileSync(`${__dirname}/src-object-selector/dist/iobrokerSelectId.umd.js`, `${__dirname}/public/iobrokerSelectId.umd.js`);
    });
