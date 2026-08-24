import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import { API_BASE } from "./config";
import { useAuthStore } from "./authStore";
import { messageForCode } from "./errors";
import type { ApiErrorEnvelope } from "../types/api";

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

async function requestRefresh(): Promise<string | null> {
  const { refreshToken, setSession, user, clearSession } =
    useAuthStore.getState();
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ access_token: string; refresh_token: string }>(
        `${API_BASE}/auth/refresh`,
        { refresh_token: refreshToken },
      )
      .then(({ data }) => {
        if (user) setSession(user, data.access_token, data.refresh_token);
        else useAuthStore.setState({ accessToken: data.access_token });
        return data.access_token;
      })
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorEnvelope>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (
      status === 401 &&
      config &&
      !config._retry &&
      !config.url?.includes("/auth/refresh") &&
      !config.url?.includes("/auth/login")
    ) {
      config._retry = true;
      const token = await requestRefresh();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return apiClient(config);
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
