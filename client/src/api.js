// Server removed — stub kept to avoid broken imports
export const api = {};
export function setToken() {}
export function getToken() {}
export async function tryApi(fn) {
  try { return await fn(); } catch { return null; }
}
