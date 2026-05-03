import { edenTreaty } from '@elysiajs/eden';
import type { App } from '@backend/index';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// 创建带类型安全的 Elysia Eden 客户端
export const api = edenTreaty<App>(apiUrl, {
  fetch: {
    credentials: 'include'
  }
});
