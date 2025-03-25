![Logo](admin/node-red.png)

# ioBroker.node-red

[![NPM version](https://img.shields.io/npm/v/iobroker.node-red?style=flat-square)](https://www.npmjs.com/package/iobroker.node-red)
[![Downloads](https://img.shields.io/npm/dm/iobroker.node-red?label=npm%20downloads&style=flat-square)](https://www.npmjs.com/package/iobroker.node-red)
![node-lts](https://img.shields.io/node/v-lts/iobroker.node-red?style=flat-square)
![Libraries.io dependency status for latest release](https://img.shields.io/librariesio/release/npm/iobroker.node-red?label=npm%20dependencies&style=flat-square)

![GitHub](https://img.shields.io/github/license/iobroker/iobroker.node-red?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/iobroker/iobroker.node-red?logo=github&style=flat-square)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/iobroker/iobroker.node-red?logo=github&style=flat-square)
![GitHub last commit](https://img.shields.io/github/last-commit/iobroker/iobroker.node-red?logo=github&style=flat-square)
![GitHub issues](https://img.shields.io/github/issues/iobroker/iobroker.node-red?logo=github&style=flat-square)
![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/iobroker/iobroker.node-red/test-and-release.yml?branch=master&logo=github&style=flat-square)

[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/node-red/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)

## Versions

![Beta](https://img.shields.io/npm/v/iobroker.node-red.svg?color=red&label=beta)
![Stable](http://iobroker.live/badges/node-red-stable.svg)
![Installed](http://iobroker.live/badges/node-red-installed.svg)

Instantiate the server with Node-RED

## Documentation

[🇺🇸 Documentation](./docs/en/README.md)

[🇩🇪 Dokumentation](./docs/de/README.md)

<!--
	Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

## Changelog
### **WORK IN PROGRESS**
-   (@GermanBluefox) Allowed to use admin instance with authentication (Admin 7.6.4 is required)

### 6.0.8 (2025-03-24)
-   (@GermanBluefox) Do not try to connect to unsecure admin from secure page and vice versa

### 6.0.7 (2025-03-24)
-   (@GermanBluefox) Replace Select-ID dialog with a library
-   (@GermanBluefox) Packages were updated

### 6.0.5 (2024-12-30)

-   (@GermanBluefox) Restart node-red if admin settings changed
-   (@GermanBluefox) Node-red updated to 4.0.8

### 6.0.1 (2024-09-30)

-   (@GermanBluefox) Corrected the case if `envVars` settings is undefined
-   (@GermanBluefox) Used common `@iobroker/eslint-config`
-   (@GermanBluefox) Node-red updated to 4.0.3

### 5.2.1 (2024-04-27)

-   (Apollon77) Update node-red to 3.1.9 to fix execution on windows
-   (Apollon77) Restore log behavior as it was in till 5.0.x

## License

Copyright 2014-2025 bluefox <dogafox@gmail.com>.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
