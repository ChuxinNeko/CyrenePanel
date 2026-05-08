import { edenTreaty } from "@elysiajs/eden";
import { getApiOrigin } from "@/lib/api-base";

const authFetcher: typeof fetch = (input, init) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
};

export const api = edenTreaty<any>(getApiOrigin(), {
  fetcher: authFetcher,
}) as any;
