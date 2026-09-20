import axios from 'axios';

const apiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const api = axios.create({ baseURL: `${apiBase}/api/v1`, timeout: 10000 });

export async function healthCheck(): Promise<boolean> {
  try { const r = await api.get('/health'); return r.status === 200; } catch { return false; }
}

export { api };
