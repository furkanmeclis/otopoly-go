"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { calendarService } from "@/features/calendar/services/calendar.service";
import type {
  CalendarEventInput,
  CalendarFeed,
  CalendarMoveInput,
} from "@/features/calendar/types";

export const calendarQueryKeys = {
  all: ["tenant", "calendar"] as const,
  meta: ["tenant", "calendar", "meta"] as const,
  feeds: ["tenant", "calendar", "feed"] as const,
  feed: (from: string, to: string, layers: string) =>
    ["tenant", "calendar", "feed", from, to, layers] as const,
  event: (uuid: string) => ["tenant", "calendar", "event", uuid] as const,
};

/** Layers the member may see / move, colours and the business time zone. */
export function useCalendarMeta(enabled = true) {
  return useQuery({
    queryKey: calendarQueryKeys.meta,
    queryFn: () => calendarService.meta(),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCalendarFeed(
  from: string,
  to: string,
  layers: string[],
  enabled = true,
) {
  const key = [...layers].sort().join(",");
  return useQuery({
    queryKey: calendarQueryKeys.feed(from, to, key),
    queryFn: () => calendarService.feed({ from, to, layers: key }),
    enabled: enabled && layers.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCalendarEvent(uuid: string | null) {
  return useQuery({
    queryKey: calendarQueryKeys.event(uuid ?? ""),
    queryFn: () => calendarService.getEvent(uuid ?? ""),
    enabled: Boolean(uuid),
    retry: false,
  });
}

/** Optimistically places a moved item in every cached feed. */
function placeInFeeds(
  feed: CalendarFeed | undefined,
  id: string,
  body: CalendarMoveInput,
): CalendarFeed | undefined {
  if (!feed) return feed;
  return {
    ...feed,
    items: feed.items.map((item) => {
      if (item.id !== id) return item;
      if (body.all_day && body.start_date) {
        return {
          ...item,
          all_day: true,
          start_date: body.start_date,
          end_date: body.end_date ?? body.start_date,
        };
      }
      if (!body.all_day && body.starts_at) {
        return {
          ...item,
          all_day: false,
          start_date: undefined,
          end_date: undefined,
          starts_at: body.starts_at,
          ends_at: body.ends_at ?? item.ends_at,
        };
      }
      return item;
    }),
  };
}

export function useCalendarMutations() {
  const qc = useQueryClient();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: calendarQueryKeys.all });
  return {
    create: useMutation({
      mutationFn: (body: CalendarEventInput) =>
        calendarService.createEvent(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        uuid,
        body,
      }: {
        uuid: string;
        body: CalendarEventInput;
      }) => calendarService.updateEvent(uuid, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (uuid: string) => calendarService.deleteEvent(uuid),
      onSuccess: invalidate,
    }),
    move: useMutation({
      mutationFn: ({ body }: { id: string; body: CalendarMoveInput }) =>
        calendarService.move(body),
      onMutate: async ({ id, body }) => {
        await qc.cancelQueries({ queryKey: calendarQueryKeys.feeds });
        const snapshot = qc.getQueriesData<CalendarFeed>({
          queryKey: calendarQueryKeys.feeds,
        });
        qc.setQueriesData<CalendarFeed>(
          { queryKey: calendarQueryKeys.feeds },
          (feed) => placeInFeeds(feed, id, body),
        );
        return { snapshot };
      },
      onError: (_err, _vars, ctx) => {
        for (const [key, data] of ctx?.snapshot ?? []) {
          qc.setQueryData(key, data);
        }
      },
      onSettled: (_data, _err, vars) => {
        invalidate();
        // Todos / leads changed in their own modules too.
        if (vars.body.layer === "todos") {
          void qc.invalidateQueries({ queryKey: ["tenant", "todos"] });
        }
        if (vars.body.layer === "leads") {
          void qc.invalidateQueries({ queryKey: ["tenant", "leads"] });
        }
      },
    }),
  };
}
