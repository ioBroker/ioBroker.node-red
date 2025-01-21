const { copyFileSync } = require('node:fs');

copyFileSync(
    `${__dirname}/node_modules/@iobroker/webcomponent-selectid-dialog/dist/iobrokerSelectId.umd.js`,
    `${__dirname}/public/iobrokerSelectId.umd.js`,
);
copyFileSync(`${__dirname}/node_modules/@iobroker/ws/dist/esm/socket.io.min.js`, `${__dirname}/public/socket.iob.js`);
