![Logo](admin/node-red.png)
ioBroker node-red Adapter
==============

# Starts node-red instance and communicates with it.

This adapter uses the node-red server from https://github.com/node-red/node-red

## Changelog
### 0.1.2 (2015-01-04)
* (bluefox) print debug message by saving

### 0.1.1 (2015-01-03)
* (bluefox) fix errors with utils.js

### 0.1.0 (2015-01-02)
* (bluefox) enable npm install

### 0.0.8 (2014-12-20)
* (bluefox) support signal stopInstance

### 0.0.7 (2014-12-14)
* (bluefox) support of select ID dialogs

### 0.0.6 (2014-11-26)
* (bluefox) use names like in mqtt: "adapter/instance/device/channel/state"
* (bluefox) suport of "value" or "object" for input node

### 0.0.5 (2014-11-22)
* (bluefox) support of new naming concept

### 0.0.4 (2014-11-05)
* (bluefox) fix some errors

### 0.0.2 (2014-11-04)
* (bluefox) use adapter.js to communicate with ioBroker

### 0.0.1 (2014-11-03)
* (bluefox) initial commit

## Install

```node iobroker.js add node-red```

## Configuration

## License

Copyright 2014 bluefox<bluefox@ccu.io>.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
