import type { ResourceChangeAction, ResourceChangedEvent } from './types';

const ACTIONS: ReadonlySet<string> = new Set(['created', 'updated', 'deleted', 'bulk']);

/**
 * Returns the `resource.changed` payload of a publication, if it is one. Accepts the flat backend payload
 * (`{type, resource, action, uuids, truncated, at}`) and the `{type|event, data: {...}}` envelope the web
 * client also understands. Join/leave pushes and other messages answer null.
 */
export function parseResourceChanged(raw: unknown): ResourceChangedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const type = typeof record.event === 'string' && record.event ? record.event : record.type;
  if (type !== 'resource.changed') return null;
  const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : record;
  const { resource, action } = data;
  if (typeof resource !== 'string' || typeof action !== 'string' || !ACTIONS.has(action)) return null;
  const uuids = Array.isArray(data.uuids) ? data.uuids.filter((id): id is string => typeof id === 'string') : [];
  return {
    resource,
    action: action as ResourceChangeAction,
    uuids,
    truncated: data.truncated === true,
    at: typeof data.at === 'string' ? data.at : undefined,
  };
}

/** True when a batch may touch the record `uuid` (or every record). */
export function eventsTouch(events: ResourceChangedEvent[], uuid: string) {
  return events.some((ev) => ev.truncated || (ev.action === 'bulk' && ev.uuids.length === 0) || ev.uuids.includes(uuid));
}
