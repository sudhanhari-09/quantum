import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient, apiGet, normalizeError } from "../core/apiClient";
import { useAuthStore } from "../core/authStore";
import type { LoginResponse, User } from "../types/api";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export async function registerUser(input: RegisterInput): Promise<User> {
  const { data } = await apiClient.post<{ user: User }>("/auth/register", input);
  return data.user;
}

export async function loginUser(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>("/auth/login", { email, password });
  return data;
}

export function useRegister(onDone: (user: User) => void) {
  return useMutation<User, ReturnType<typeof normalizeError>, RegisterInput>({
    mutationFn: registerUser,
    onSuccess: onDone,
  });
}

export function useLogin(onDone: (res: LoginResponse) => void) {
  return useMutation<LoginResponse, ReturnType<typeof normalizeError>, { email: string; password: string }>({
    mutationFn: ({ email, password }) => loginUser(email, password),
    onSuccess: onDone,
  });
}

export function useMe(enabled: boolean) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet<{ user: User }>("/auth/me"),
    enabled: enabled && accessToken != null,
    retry: false,
    staleTime: 60_000,
  });
}
