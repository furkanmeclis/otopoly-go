import type { ApiError } from './errors';

/**
 * Global API error bus. The UI layer subscribes once (toast host, limit dialog)
 * so individual screens don't have to repeat generic error handling.
 */
type Listener = (error: ApiError) => void;
const listeners = new Set<Listener>();

export function emitApiEvent(error: ApiError) {
  for (const l of listeners) l(error);
}

export function subscribeApiEvents(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
