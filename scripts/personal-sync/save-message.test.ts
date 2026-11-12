import { expect, test } from "vitest";
import {
  createStore,
  type PersonalItem,
} from "../../src/bundled/personal-lists/model";
import { saveMessage } from "../../plugins/personal-lists/save-message";

test("message save waits for sync, deduplicates, and keeps failures retryable", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: PersonalItem[] = [];
  let fail = false;
  const list = createStore(async ({ item }) => {
    if (!item) {
      await gate;
      return { status: 200, body: { items: [] } };
    }
    if (fail) return { status: 503, body: { error: "Offline" } };
    writes.push(item);
    return {
      status: 200,
      body: { item: { ...item, revision: item.revision + 1 } },
    };
  });
  const message = {
    id: "b".repeat(64),
    channelId: "c".repeat(64),
    authorId: "a".repeat(64),
    content: "Sample message",
  };
  const refreshing = list.refresh();
  const saving = saveMessage(list, "saved", message, () => true);
  expect(writes).toHaveLength(0);
  release();
  await Promise.all([refreshing, saving]);
  expect(writes).toHaveLength(1);
  expect(list.snapshot().items[0]?.target?.eventId).toBe(message.id);
  await expect(saveMessage(list, "saved", message, () => true)).resolves.toBe(
    false,
  );
  expect(writes).toHaveLength(1);
  fail = true;
  await expect(saveMessage(list, "todo", message, () => true)).rejects.toThrow(
    "Offline",
  );
  expect(list.snapshot().items[0]?.kind).toBe("saved");
  fail = false;
  await saveMessage(list, "todo", message, () => true);
  expect(list.snapshot().items).toHaveLength(1);
  expect(list.snapshot().items[0]?.kind).toBe("todo");
  await expect(
    saveMessage(list, "saved", message, () => false),
  ).rejects.toThrow("Account changed");
  expect(writes).toHaveLength(2);
});
