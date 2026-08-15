// This file extends the AdapterConfig type from "@types/iobroker"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            bind: string;
            port: number | string;
            secure: boolean;
            certPublic: string;
            certPrivate: string;
            httpAdminRoot: string;
            httpNodeRoot: string;
            httpStatic: string;
            /** Normally an array, but older configurations may still contain a separated list */
            npmLibs: string[] | string;
            maxMemory: number | string;
            /** Older configurations may still contain the value as string or number */
            valueConvert: boolean | string | number;
            palletmanagerEnabled: boolean;
            /** Not present in configurations created before this option was introduced */
            projectsEnabled?: boolean;
            /** Not present in configurations created before this option was introduced */
            allowCreationOfForeignObjects?: boolean;
            safeMode: boolean;
            doNotReadObjectsDynamically: boolean;
            /** Empty or missing for instances that were created before the authentication types were introduced */
            authType?: 'None' | 'Simple' | 'Extended' | '';
            user: string;
            pass: string;
            hasDefaultPermissions: boolean;
            defaultPermissions: string;
            authExt: { username: string; password: string; permissions: string }[];
            editor: 'monaco' | 'ace';
            theme: string;
            envVars: { name: string; value: string }[];
        }
    }
}

export {};
