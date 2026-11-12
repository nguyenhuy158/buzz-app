import {
  newItem,
  type PersonalItem,
  type PersonalStore,
} from "../../src/bundled/personal-lists/model";
import type { ChannelMessage } from "../../src/features/relay/contracts";

export async function saveMessage(
  list: PersonalStore,
  kind: PersonalItem["kind"],
  message: Pick<ChannelMessage, "id" | "content" | "channelId" | "authorId">,
  isCurrent: () => boolean,
) {
  while (list.snapshot().busy) {
    await new Promise<void>((resolve) => {
      const off = list.subscribe(() => {
        if (!list.snapshot().busy) {
          off();
          resolve();
        }
      });
    });
  }
  if (!isCurrent()) throw new Error("Account changed. Try again.");
  if (!list.snapshot().loaded) await list.refresh();
  if (!list.snapshot().loaded)
    throw new Error(
      list.snapshot().error || "Could not load your list. Try again.",
    );
  if (!isCurrent()) throw new Error("Account changed. Try again.");
  const existing = list
    .snapshot()
    .items.find((item) => item.target?.eventId === message.id);
  if (existing?.kind === kind) return false;
  await list.save(
    existing
      ? { ...existing, kind, due: null, done: false }
      : {
          ...newItem(
            kind,
            message.content.trim().slice(0, 1000) || "Saved file",
          ),
          target: {
            eventId: message.id,
            channelId: message.channelId,
            authorPubkey: message.authorId,
          },
        },
  );
  return true;
}
