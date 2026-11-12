import { verifyEvent } from "nostr-tools/pure";

const hex = /^[a-f0-9]{64}$/;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const encoder = new TextEncoder();

function reply(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function bodyText(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new Error("body-limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function authorized(request, owner, body) {
  try {
    const header = request.headers.get("Authorization") ?? "";
    if (
      !hex.test(owner ?? "") ||
      !header.startsWith("Nostr ") ||
      header.length > 4096
    )
      return false;
    const event = JSON.parse(atob(header.slice(6)));
    const tag = (key) => {
      const found = event.tags.filter((entry) => entry[0] === key);
      return found.length === 1 && found[0].length === 2
        ? found[0][1]
        : undefined;
    };
    if (
      event.pubkey !== owner ||
      event.kind !== 27235 ||
      event.content !== "" ||
      !Number.isSafeInteger(event.created_at) ||
      Math.abs(Date.now() / 1000 - event.created_at) > 60 ||
      !verifyEvent(event) ||
      tag("u") !== request.url ||
      tag("method") !== request.method
    )
      return false;
    if (request.method === "POST") {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(body),
      );
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (tag("payload") !== hash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validCommunity(value) {
  try {
    const url = new URL(value);
    return (
      value.length <= 512 &&
      ["https:", "wss:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function validItem(item) {
  if (!item || typeof item !== "object") return false;
  if (!idPattern.test(item.id ?? "") || !["saved", "todo"].includes(item.kind))
    return false;
  if (
    typeof item.text !== "string" ||
    !item.text.trim() ||
    encoder.encode(item.text).length > 4096
  )
    return false;
  if (typeof item.done !== "boolean" || typeof item.deleted !== "boolean")
    return false;
  if (
    item.due !== null &&
    (!Number.isSafeInteger(item.due) || item.due < 0 || item.due > 253402300799)
  )
    return false;
  if (item.kind === "saved" && (item.due !== null || item.done)) return false;
  if (
    !Number.isSafeInteger(item.revision) ||
    item.revision < 0 ||
    item.revision >= Number.MAX_SAFE_INTEGER
  )
    return false;
  const target = item.target;
  return (
    target === null ||
    (target &&
      typeof target === "object" &&
      hex.test(target.eventId ?? "") &&
      hex.test(target.authorPubkey ?? "") &&
      typeof target.channelId === "string" &&
      target.channelId.length > 0 &&
      target.channelId.length <= 512)
  );
}

function decode(row) {
  return {
    ...row,
    target: row.target ? JSON.parse(row.target) : null,
    done: Boolean(row.done),
    deleted: Boolean(row.deleted),
  };
}

const fields =
  "id, kind, text, target, due, done, deleted, revision, created, updated";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/items") return reply({ error: "Not found" }, 404);
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Method not allowed" }, 405);
    let body;
    try {
      body = await bodyText(request);
    } catch {
      return reply({ error: "Body is too large or not valid UTF-8" }, 413);
    }
    if (!(await authorized(request, env.BUZZ_OWNER, body)))
      return reply({ error: "Sign in with the owner account" }, 401);
    const community = url.searchParams.get("community");
    if (!community || !validCommunity(community))
      return reply({ error: "Invalid community" }, 400);
    try {
      const db = env.DB.withSession("first-primary");
      if (request.method === "GET") {
        const cursor = url.searchParams.get("cursor") ?? "";
        if (cursor && !idPattern.test(cursor))
          return reply({ error: "Invalid cursor" }, 400);
        const { results } = await db
          .prepare(
            `SELECT ${fields} FROM buzz_items WHERE owner = ? AND community = ? AND id > ? ORDER BY id LIMIT 101`,
          )
          .bind(env.BUZZ_OWNER, community, cursor)
          .all();
        const items = results.slice(0, 100).map(decode);
        return reply({
          items,
          cursor: results.length > 100 ? items.at(-1).id : null,
        });
      }
      let item;
      try {
        item = JSON.parse(body);
      } catch {
        return reply({ error: "Invalid JSON" }, 400);
      }
      if (!validItem(item)) return reply({ error: "Invalid item" }, 400);
      const target =
        item.target === null
          ? null
          : JSON.stringify({
              eventId: item.target.eventId,
              channelId: item.target.channelId,
              authorPubkey: item.target.authorPubkey,
            });
      const now = Math.floor(Date.now() / 1000);
      const { results } = await db
        .prepare(`INSERT INTO buzz_items (owner, community, id, kind, text, target, due, done, deleted, revision, created, updated)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10 WHERE ?11 = 0
        ON CONFLICT (owner, community, id) DO NOTHING RETURNING ${fields}`)
        .bind(
          env.BUZZ_OWNER,
          community,
          item.id,
          item.kind,
          item.text,
          target,
          item.due,
          Number(item.done),
          Number(item.deleted),
          now,
          item.revision,
        )
        .all();
      if (results.length) return reply({ item: decode(results[0]) });
      if (item.revision === 0)
        return reply(
          { error: "This item changed. Refresh and try again." },
          409,
        );
      const updated = await db
        .prepare(
          `UPDATE buzz_items SET kind = ?, text = ?, target = ?, due = ?, done = ?, deleted = ?, revision = revision + 1, updated = ? WHERE owner = ? AND community = ? AND id = ? AND revision = ? AND deleted = 0 RETURNING ${fields}`,
        )
        .bind(
          item.kind,
          item.text,
          target,
          item.due,
          Number(item.done),
          Number(item.deleted),
          now,
          env.BUZZ_OWNER,
          community,
          item.id,
          item.revision,
        )
        .all();
      return updated.results.length
        ? reply({ item: decode(updated.results[0]) })
        : reply({ error: "This item changed. Refresh and try again." }, 409);
    } catch {
      return reply({ error: "Sync is not available. Try again." }, 503);
    }
  },
};
