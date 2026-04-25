declare module 'stremio-addon-sdk' {
    export class addonBuilder {
        constructor(manifest: import('./index').Manifest);
        defineStreamHandler(handler: (args: { type: string; id: string }) => Promise<{ streams: import('./index').Stream[] }>): void;
        defineMetaHandler(handler: (args: { type: string; id: string }) => Promise<{ meta: import('./index').Meta | null }>): void;
        defineCatalogHandler(handler: (args: { type: string; id: string; extra: any }) => Promise<{ metas: import('./index').Meta[] }>): void;
        getInterface(): any;
    }

    export function serveHTTP(addonInterface: any, options: { port: number }): void;
}
