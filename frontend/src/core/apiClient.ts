import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { API_BASE } from "./config";
import { useAuthStore } from "./authStore";
import { messageForCode } from "./errors";
import { expireSession, refreshSession } from "./session";
import type { ApiErrorEnvelope } from "../types/api";

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/** Endpoints that must never trigger the refresh/retry loop. */
const AUTH_ENDPOINTS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

function isAuthEndpoint(url?: string): boolean {
  return !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  // Always the newest token from the store (never a captured copy).
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorEnvelope>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.code;

    if (status === 401 && config && !isAuthEndpoint(config.url)) {
      if (code === "TOKEN_REUSED") {
        // The backend revoked the whole token family: retrying is pointless.
        expireSession("reused");
        return Promise.reject(normalizeError(error));
      }
      if (!config._retry) {
        // Retry the ORIGINAL request exactly once, with the rotated token.
        config._retry = true;
        const token = await refreshSession();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          return apiClient(config);
        }
        // Refresh failed → expireSession() already ran (401/403) or the
        // network is down (session intentionally kept).
      }
    }

    return Promise.reject(normalizeError(error));
  },
);

export interface NormalizedError {
  status?: number;
  code: string;
  message: string;
  raw?: unknown;
}

export function normalizeError(error: unknown): NormalizedError {
  if (axios.isAxiosError<ApiErrorEnvelope>(error)) {
    const envelope = error.response?.data;
    const code = envelope?.code ?? "UNKNOWN";
    return {
      status: error.response?.status,
      code,
      // Never surface raw backend exception text (F32 invariant).
      message: messageForCode(code),
      raw: undefined,
    };
  }
  return { code: "UNKNOWN", message: messageForCode(undefined), raw: error };
}

/** Typed helper for query hooks. */
export async function apiGet<T>(url: string, params?: object): Promise<T> {
  const { data } = await apiClient.get<T>(url, { params });
  return data;
}

export async function apiPost<T>(url: string, body?: object): Promise<T> {
  const { data } = await apiClient.post<T>(url, body);
  return data;
}

export async function apiPatch<T>(url: string, body?: object): Promise<T> {
  const { data } = await apiClient.patch<T>(url, body);
  return data;
}
