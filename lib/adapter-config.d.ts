// This file extends the AdapterConfig type from "@types/iobroker"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

import { type native } from '../io-package.json';

type _AdapterConfig = Partial<typeof native>;

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        // tslint:disable-next-line:no-empty-interface
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
        }
    }
}
