/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
