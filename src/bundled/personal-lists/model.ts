export type PersonalItem = {
  id: string;
  kind: "saved" | "todo";
  text: string;
  target: { eventId: string; channelId: string; authorPubkey: string } | null;
  due: number | null;
  done: boolean;
  deleted: boolean;
  revision: number;
  created: number;
  updated: number;
};

export type SyncState = {
  items: PersonalItem[];
  busy: boolean;
  loaded: boolean;
  error: string;
  reminderError: string;
};

type Reply = {
  status: number;
  body: {
    items?: PersonalItem[];
    item?: PersonalItem;
    cursor?: string | null;
    error?: string;
  };
};

export function createStore(
  request: (args: { cursor?: string; item?: PersonalItem }) => Promise<Reply>,
  schedule: (items: PersonalItem[]) => Promise<void> = async () => {},
) {
  let state: SyncState = {
    items: [],
    busy: false,
    loaded: false,
    error: "",
    reminderError: "",
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<SyncState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const checked = async (args: { cursor?: string; item?: PersonalItem }) => {
    const reply = await request(args);
    if (reply.status !== 200)
      throw new Error(reply.body.error || "Sync failed. Try again.");
    return reply.body;
  };
  const reminders = async () => {
    try {
      await schedule(state.items);
      update({ reminderError: "" });
    } catch (error) {
      update({
        reminderError: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      if (state.busy) return;
      update({ busy: true, error: "" });
      try {
        const items = new Map<string, PersonalItem>();
        let cursor: string | undefined;
        do {
          const reply = await checked(cursor ? { cursor } : {});
          if (!Array.isArray(reply.items))
            throw new Error("Invalid sync reply");
          for (const item of reply.items) items.set(item.id, item);
          const next = reply.cursor ?? undefined;
          if (next && cursor && next <= cursor)
            throw new Error("Invalid sync page");
          cursor = next;
        } while (cursor);
        update({
          items: [...items.values()].filter((item) => !item.deleted),
          loaded: true,
        });
        await reminders();
      } catch (error) {
        update({
          error: String(error instanceof Error ? error.message : error),
        });
      } finally {
        update({ busy: false });
      }
    },
    async save(item: PersonalItem) {
      if (!state.loaded)
        throw new Error("Refresh your list before making changes.");
      if (state.busy) throw new Error("Sync is busy. Try again.");
      update({ busy: true, error: "" });
      try {
        const reply = await checked({ item });
        if (!reply.item) throw new Error("Invalid sync reply");
        const saved = reply.item;
        update({
          items: [
            ...state.items.filter((row) => row.id !== item.id),
            ...(saved.deleted ? [] : [saved]),
          ],
        });
        await reminders();
      } catch (error) {
        update({
          error: String(error instanceof Error ? error.message : error),
        });
        throw error;
      } finally {
        update({ busy: false });
      }
    },
  };
}

export type PersonalStore = ReturnType<typeof createStore>;

export function matchesFilter(item: PersonalItem, filter: string, now: number) {
  switch (filter) {
    case "open":
      return !item.done;
    case "done":
      return item.done;
    case "overdue":
      return !item.done && item.due !== null && item.due <= now;
    case "upcoming":
      return !item.done && item.due !== null && item.due > now;
    case "none":
      return !item.done && item.due === null;
    default:
      return true;
  }
}

export function newItem(
  kind: PersonalItem["kind"],
  text: string,
): PersonalItem {
  return {
    id: crypto.randomUUID(),
    kind,
    text,
    target: null,
    due: null,
    done: false,
    deleted: false,
    revision: 0,
    created: 0,
    updated: 0,
  };
}
