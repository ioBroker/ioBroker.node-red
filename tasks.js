const { copyFileSync } = require('node:fs');

copyFileSync(
    `${__dirname}/node_modules/@iobroker/webcomponent-selectid-dialog/build/iobrokerSelectId.umd.js`,
    `${__dirname}/public/iobrokerSelectId.umd.js`,
);
copyFileSync(`${__dirname}/node_modules/@iobroker/ws/build/esm/socket.io.min.js`, `${__dirname}/public/socket.iob.js`);
