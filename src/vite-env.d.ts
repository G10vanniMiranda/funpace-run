/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_META_PIXEL_REQUIRE_CONSENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
