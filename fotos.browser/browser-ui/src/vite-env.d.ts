/// <reference types="vite/client" />
interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_COMM_SERVER_URL?: string;
    readonly VITE_TRUSTED_SYSTEM_KEYS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
