import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { prefs, StorageKeys } from '@/lib/storage';

import type { CalendarFeedItem, CalendarLayer } from '../types';
import { LAYER_DEFS } from './layers';

/** Layers switched off in the chips, remembered on the device. */
export function useHiddenLayers() {
  const [hidden, setHidden] = useState<ReadonlySet<CalendarLayer>>(new Set());
  useEffect(() => {
    let active = true;
    prefs.get<CalendarLayer[]>(StorageKeys.calendarHiddenLayers, []).then((list) => {
      if (active && Array.isArray(list)) setHidden(new Set(list));
    });
    return () => {
      active = false;
    };
  }, []);
  const update = useCallback((next: Set<CalendarLayer>) => {
    setHidden(next);
    void prefs.set(StorageKeys.calendarHiddenLayers, [...next]);
  }, []);
  const toggle = useCallback(
    (layer: CalendarLayer) => {
      const next = new Set(hidden);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      update(next);
    },
    [hidden, update],
  );
  const setAll = useCallback((visible: boolean, layers: CalendarLayer[]) => update(visible ? new Set() : new Set(layers)), [update]);
  return { hidden, toggle, setAll };
}

/** Tap on an item: module records open their screen, own events (no screen) go to `onEvent`. */
export function openItem(item: CalendarFeedItem, onEvent: (item: CalendarFeedItem) => void) {
  const href = LAYER_DEFS[item.layer]?.href(item);
  if (href) router.push(href);
  else onEvent(item);
}
