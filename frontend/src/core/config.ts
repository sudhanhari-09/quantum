export const API_BASE: string =
  import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export const WS_BASE: string =
  import.meta.env.VITE_WS_BASE_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

export const ENABLE_MOCKS: boolean =
  import.meta.env.VITE_ENABLE_MOCKS === "1";

export const APP_VERSION = "0.1.0";
