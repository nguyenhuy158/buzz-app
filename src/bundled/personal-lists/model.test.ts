import { expect, test } from "vitest";
import {
  createStore,
  matchesFilter,
  newItem,
  type PersonalItem,
} from "./model";

test("due filters keep done tasks out and include the due boundary", () => {
  const item = newItem("todo", "Task");
  expect(matchesFilter(item, "none", 100)).toBe(true);
  expect(matchesFilter({ ...item, due: 100 }, "overdue", 100)).toBe(true);
  expect(matchesFilter({ ...item, due: 101 }, "upcoming", 100)).toBe(true);
  expect(matchesFilter({ ...item, due: 99, done: true }, "overdue", 100)).toBe(
    false,
  );
});

test("sync keeps confirmed data on errors and reports reminder errors separately", async () => {
  const item = { ...newItem("todo", "Read the notes"), revision: 1 };
  let rows = [item];
  let fail = false;
  const scheduled: PersonalItem[][] = [];
  const store = createStore(
    async ({ item: update }) => {
      if (fail) return { status: 409, body: { error: "Refresh first" } };
      if (update) {
        const saved = { ...update, revision: update.revision + 1 };
        rows = [saved];
        return { status: 200, body: { item: saved } };
      }
      return { status: 200, body: { items: rows, cursor: null } };
    },
    async (items) => {
      scheduled.push(items);
      throw new Error("Notifications are off");
    },
  );
  await expect(store.save(item)).rejects.toThrow("Refresh");
  await store.refresh();
  expect(store.snapshot().loaded).toBe(true);
  expect(store.snapshot().reminderError).toBe("Notifications are off");
  await store.save({ ...item, done: true });
  expect(store.snapshot().items[0]?.done).toBe(true);
  expect(store.snapshot().items[0]?.revision).toBe(2);
  fail = true;
  await expect(store.save({ ...item, text: "Stale" })).rejects.toThrow(
    "Refresh first",
  );
  await store.refresh();
  expect(store.snapshot().items[0]?.text).toBe("Read the notes");
  expect(store.snapshot().busy).toBe(false);
  expect(scheduled).toHaveLength(2);
  fail = false;
  const current = rows[0];
  if (!current) throw new Error("Missing saved row");
  await store.save({ ...current, deleted: true });
  expect(store.snapshot().items).toEqual([]);
});
