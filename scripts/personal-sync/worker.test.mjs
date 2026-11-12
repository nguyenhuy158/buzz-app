import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { expect, test } from "vitest";
import worker from "./worker.mjs";

test("owner auth, safe updates, delete conflicts, and community isolation", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(
    readFileSync(
      new URL("./migrations/0001_items.sql", import.meta.url),
      "utf8",
    ),
  );
  const key = generateSecretKey();
  const env = {
    BUZZ_OWNER: getPublicKey(key),
    DB: {
      withSession: () => ({
        prepare: (query) => ({
          bind: (...params) => ({
            all: async () => ({ results: sql.prepare(query).all(...params) }),
          }),
        }),
      }),
    },
  };
  const base = "https://sync.example/items?community=wss%3A%2F%2Frelay.example";
  async function request(item, options = {}) {
    const url = options.url ?? base;
    const body = item ? JSON.stringify(item) : "";
    const method = item ? "POST" : "GET";
    const event = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000) + (options.age ?? 0),
        tags: [
          ["u", url],
          ["method", options.method ?? method],
          ["payload", createHash("sha256").update(body).digest("hex")],
        ],
        content: "",
      },
      options.key ?? key,
    );
    return worker.fetch(
      new Request(url, {
        method,
        headers: { Authorization: `Nostr ${btoa(JSON.stringify(event))}` },
        ...(item ? { body: options.body ?? body } : {}),
      }),
      env,
    );
  }
  try {
    expect((await worker.fetch(new Request(base), env)).status).toBe(401);
    expect((await request(null, { key: generateSecretKey() })).status).toBe(
      401,
    );
    expect((await request(null, { age: -120 })).status).toBe(401);
    expect((await request(null, { method: "POST" })).status).toBe(401);
    const item = {
      id: "one",
      kind: "todo",
      text: "Test task",
      target: null,
      due: null,
      done: false,
      deleted: false,
      revision: 0,
    };
    expect(
      (
        await request(item, {
          body: JSON.stringify({ ...item, text: "Changed" }),
        })
      ).status,
    ).toBe(401);
    expect((await request({ ...item, due: "bad" })).status).toBe(400);
    const created = await (await request(item)).json();
    expect(created.item.revision).toBe(1);
    expect((await request(item)).status).toBe(409);
    const edited = await (
      await request({ ...created.item, done: true })
    ).json();
    expect(edited.item.revision).toBe(2);
    expect(
      (await request({ ...created.item, text: "Stale change" })).status,
    ).toBe(409);
    expect((await (await request(null)).json()).items[0].done).toBe(true);
    expect(
      (await (await request(null, { url: `${base}-other` })).json()).items,
    ).toEqual([]);
    expect((await request({ ...edited.item, deleted: true })).status).toBe(200);
    expect(
      (await request({ ...edited.item, revision: 3, deleted: false })).status,
    ).toBe(409);
    const deleted = await (await request(null)).json();
    expect(deleted.items[0].deleted).toBe(true);
    expect(deleted.items[0].revision).toBe(3);
    const insert = sql.prepare(
      "INSERT INTO buzz_items VALUES (?, ?, ?, 'saved', 'Page', NULL, NULL, 0, 0, 1, 1, 1)",
    );
    for (let index = 0; index < 101; index++)
      insert.run(
        env.BUZZ_OWNER,
        "wss://relay.example",
        `page-${String(index).padStart(3, "0")}`,
      );
    const first = await (await request(null)).json();
    expect(first.items).toHaveLength(100);
    expect(first.cursor).toBeTruthy();
    const second = await (
      await request(null, { url: `${base}&cursor=${first.cursor}` })
    ).json();
    expect(second.items).toHaveLength(2);
    expect(second.cursor).toBeNull();
  } finally {
    sql.close();
  }
});
