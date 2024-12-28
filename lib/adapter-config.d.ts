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
            npmLibs: [];
            maxMemory: number;
            valueConvert: boolean;
            palletmanagerEnabled: boolean;
            projectsEnabled: boolean;
            allowCreationOfForeignObjects: boolean;
            safeMode: boolean;
            doNotReadObjectsDynamically: boolean;
            authType: 'None' | 'Simple' | 'Extended';
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
