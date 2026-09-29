/**
 * Runtime configuration from EXPO_PUBLIC_* variables (inlined by Metro at build time).
 *
 *   EXPO_PUBLIC_API_MODE=mock|live   (default: mock until the backend is wired)
 *   EXPO_PUBLIC_API_URL=https://api.otopoly.com   (Go API origin, without /v1)
 */
export type ApiMode = 'mock' | 'live';

const rawMode = process.env.EXPO_PUBLIC_API_MODE;

export const env = {
  apiMode: (rawMode === 'live' ? 'live' : 'mock') as ApiMode,
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  /** Simulated network latency for the mock adapter (ms). */
  mockLatency: Number(process.env.EXPO_PUBLIC_MOCK_LATENCY ?? 350),
  requestTimeoutMs: 20000,
} as const;

export const isMock = env.apiMode === 'mock';
