const PRODUCTION_API_BASE = 'https://api.glue.one';
const PRODUCTION_SYSTEM_KEY = 'a3200bb92c386ec0236cf8252e3ce80616f985178819b5d07b3ca657bb4ea11d';

// In local Vite dev we proxy REST calls through the dev server to avoid
// production CORS restrictions from http://localhost.
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? '/api' : PRODUCTION_API_BASE);

export const COMM_SERVER_URL = import.meta.env.VITE_COMM_SERVER_URL || 'wss://api.glue.one/comm';

export const TRUSTED_SYSTEM_PUBLIC_KEYS: string[] =
  (import.meta.env.VITE_TRUSTED_SYSTEM_KEYS || PRODUCTION_SYSTEM_KEY)
    .split(',')
    .filter(Boolean);
