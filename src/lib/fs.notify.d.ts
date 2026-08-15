// Type definitions for the untyped "fs.notify" package (https://www.npmjs.com/package/fs.notify)

declare module 'fs.notify' {
    import { EventEmitter } from 'node:events';

    /** Watches the given files and emits a "change" event whenever one of them is modified */
    class Notify extends EventEmitter {
        constructor(files?: string | string[]);

        /** Add files that should be watched for changes. Non-existing paths are silently ignored */
        add(files: string | string[]): this;

        /** Close all file watchers */
        close(): void;
    }

    export = Notify;
}
