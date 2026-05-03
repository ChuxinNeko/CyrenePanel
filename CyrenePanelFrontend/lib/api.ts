import { edenTreaty } from '@elysiajs/eden';
import type { App } from '@backend/index';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// 自定义 fetcher，自动注入 Authorization header
const authFetcher: typeof fetch = (input, init) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
};

// 创建带类型安全的 Elysia Eden 客户端
export const api = edenTreaty<App>(apiUrl, {
  fetcher: authFetcher,
});