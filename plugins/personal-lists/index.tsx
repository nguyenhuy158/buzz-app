import type { PluginModule } from "../../src/plugins/api";
import type {} from "../../src/features/host/service";
import type {} from "../../src/features/conversation/service";
import type {} from "../../src/features/pages/service";
import type {} from "../../src/features/relay/service";
import type {} from "../../src/features/navigation/controller";
import { splitPartition } from "../../src/features/relay/partition";
import {
  createStore,
  matchesFilter,
  newItem,
  type PersonalItem,
} from "../../src/bundled/personal-lists/model";
import { createRequest } from "./auth.ts";

declare const PERSONAL_SYNC_URL: string;
export const inject = [
  "react",
  "pages",
  "relay",
  "navigation",
  "conversation",
  "host",
];

export const apply: PluginModule["apply"] = (ctx) => {
  const React = ctx.react;
  let active = true;
  let currentKey = "";
  let store: ReturnType<typeof createStore> | undefined;
  const helperEnabled = () =>
    localStorage.getItem("personal.lists.reminders") === "on";
  function currentStore() {
    const connection = ctx.relay.snapshot();
    const scope = connection.scope && splitPartition(connection.scope);
    if (
      !active ||
      connection.status !== "ready" ||
      !scope ||
      scope.viewer !== connection.viewer
    )
      return;
    if (currentKey !== connection.scope) {
      currentKey = connection.scope;
      const key = currentKey;
      const isCurrent = () =>
        active &&
        ctx.relay.snapshot().scope === key &&
        ctx.relay.snapshot().status === "ready";
      store = createStore(
        createRequest(ctx.host, scope, isCurrent, PERSONAL_SYNC_URL),
        async (items) => {
          if (!helperEnabled()) return;
          if (!isCurrent()) throw new Error("Account changed. Refresh again.");
          const tasks = items
            .filter(
              (item) => item.kind === "todo" && !item.done && item.due !== null,
            )
            .map((item) => ({ id: item.id, due: item.due }));
          const result = await ctx.host.runCommand(
            "reminders",
            JSON.stringify({
              viewer: scope.viewer,
              community: scope.communityOrigin,
              tasks,
            }),
          );
          if (result !== "ok\n")
            throw new Error("Install the reminder helper, then refresh.");
        },
      );
    }
    return store;
  }
  ctx.effect(() => {
    const refresh = () => void currentStore()?.refresh();
    const off = ctx.relay.subscribe(() => {
      if (ctx.relay.snapshot().scope !== currentKey) refresh();
    });
    const interval = setInterval(refresh, 60000);
    refresh();
    return () => {
      active = false;
      off();
      clearInterval(interval);
      store = undefined;
    };
  });
  function Button({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
      <button
        type="button"
        data-buzz-ui=""
        className="buzz-button"
        data-variant="subtle"
        data-size="sm"
        data-button-shape="capsule"
        {...props}
      >
        <span className="buzz-button-label">{children}</span>
      </button>
    );
  }
  const row = {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
    alignItems: "center",
  } as const;
  for (const kind of ["saved", "todo"] as const) {
    const title = kind === "saved" ? "Saved" : "To-dos";
    const pageId = kind === "saved" ? "saved" : "todos";
    function List({ list }: { list: ReturnType<typeof createStore> }) {
      const state = React.useSyncExternalStore(
        list.subscribe,
        list.snapshot,
        list.snapshot,
      );
      const [text, setText] = React.useState("");
      const [due, setDue] = React.useState("");
      const [editing, setEditing] = React.useState<PersonalItem | null>(null);
      const [filter, setFilter] = React.useState("all");
      const [sort, setSort] = React.useState("newest");
      const [error, setError] = React.useState("");
      const [clear, setClear] = React.useState(false);
      const [clearing, setClearing] = React.useState(false);
      const [reminders, setReminders] = React.useState(helperEnabled);
      const busy = state.busy || clearing;
      const items = state.items
        .filter(
          (item) =>
            item.kind === kind &&
            matchesFilter(item, filter, Date.now() / 1000),
        )
        .sort((a, b) =>
          sort === "due"
            ? (a.due ?? Infinity) - (b.due ?? Infinity) || b.created - a.created
            : b.created - a.created,
        );
      async function save(item: PersonalItem) {
        setError("");
        try {
          await list.save(item);
          return true;
        } catch (error) {
          setError(String(error instanceof Error ? error.message : error));
          return false;
        }
      }
      function edit(item: PersonalItem) {
        setEditing(item);
        setText(item.text);
        const date = item.due === null ? null : new Date(item.due * 1000);
        setDue(
          date
            ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16)
            : "",
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <div style={row}>
            {kind === "todo" && (
              <label>
                Filter{" "}
                <select
                  aria-label="Filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  {[
                    ["all", "All"],
                    ["open", "Open"],
                    ["done", "Done"],
                    ["overdue", "Overdue"],
                    ["upcoming", "Upcoming"],
                    ["none", "No reminder"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Sort{" "}
              <select
                aria-label="Sort"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="newest">Newest first</option>
                {kind === "todo" && <option value="due">Due date</option>}
              </select>
            </label>
            <Button disabled={busy} onClick={() => void list.refresh()}>
              Refresh
            </Button>
            <span role="status">
              {state.busy ? "Syncing…" : state.loaded ? "Synced" : "Not synced"}
            </span>
          </div>
          {kind === "todo" && (
            <form
              style={{ display: "grid", gap: "var(--space-3)" }}
              onSubmit={(event) => {
                event.preventDefault();
                const timestamp = due
                  ? Math.floor(new Date(due).getTime() / 1000)
                  : null;
                if (
                  timestamp !== null &&
                  (!Number.isFinite(timestamp) ||
                    timestamp <= Date.now() / 1000)
                ) {
                  setError("Choose a future time.");
                  return;
                }
                void save({
                  ...(editing ?? newItem("todo", text.trim())),
                  text: text.trim(),
                  due: timestamp,
                }).then((saved) => {
                  if (saved) {
                    setText("");
                    setDue("");
                    setEditing(null);
                  }
                });
              }}
            >
              <label className="buzz-field">
                {editing ? "Edit task" : "New task"}
                <input
                  data-buzz-ui=""
                  className="buzz-input"
                  data-size="md"
                  value={text}
                  required
                  maxLength={1000}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <label className="buzz-field">
                Reminder (optional)
                <input
                  data-buzz-ui=""
                  className="buzz-input"
                  data-size="md"
                  type="datetime-local"
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                />
              </label>
              <div style={row}>
                <Button type="submit" disabled={busy || !text.trim()}>
                  {editing ? "Save task" : "Add task"}
                </Button>
                {editing && (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setText("");
                      setDue("");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          )}
          {(error || state.error) && <p role="alert">{error || state.error}</p>}
          {kind === "todo" && (
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={reminders}
                  disabled={busy}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    if (enabled) {
                      localStorage.setItem("personal.lists.reminders", "on");
                      setReminders(true);
                      void list.refresh();
                    } else
                      void ctx.host
                        .runCommand(
                          "reminders",
                          JSON.stringify({ clear: true }),
                        )
                        .then((result) => {
                          if (result !== "ok\n")
                            throw new Error(
                              "Could not clear reminders. Check the helper.",
                            );
                          localStorage.removeItem("personal.lists.reminders");
                          setReminders(false);
                        })
                        .catch((error) => setError(String(error)));
                  }}
                />{" "}
                Use the Mac reminder helper
              </label>
              <p className="text-body-sm">
                Install the helper first. Reminders use the last sync on this
                Mac, even after Buzz quits. Turn this off before removing the
                plugin.
              </p>
              {state.reminderError && (
                <p role="alert">
                  Tasks are saved. Reminders: {state.reminderError}
                </p>
              )}
            </div>
          )}
          <div style={row}>
            <Button
              disabled={
                busy ||
                !state.items.some(
                  (item) =>
                    item.kind === kind && (kind === "saved" || item.done),
                )
              }
              onClick={() => setClear(true)}
            >
              {kind === "saved" ? "Clear Saved" : "Clear done tasks"}
            </Button>
          </div>
          {clear && (
            <fieldset aria-label="Confirm removal">
              <p>Remove these items on all your devices?</p>
              <div style={row}>
                <Button disabled={busy} onClick={() => setClear(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setClearing(true);
                    void (async () => {
                      for (const item of state.items.filter(
                        (item) =>
                          item.kind === kind && (kind === "saved" || item.done),
                      ))
                        if (!(await save({ ...item, deleted: true }))) break;
                      setClearing(false);
                      setClear(false);
                    })();
                  }}
                >
                  Remove items
                </Button>
              </div>
            </fieldset>
          )}
          {!items.length && (
            <p>
              {state.loaded
                ? `No ${title.toLowerCase()} here.`
                : state.error
                  ? "Refresh to try again."
                  : "Loading your list…"}
            </p>
          )}
          {items.map((item) => (
            <article
              key={item.id}
              style={{
                display: "grid",
                gap: "var(--space-2)",
                borderBottom: "1px solid var(--border-subtle)",
                paddingBlock: "var(--space-3)",
                overflowWrap: "anywhere",
              }}
            >
              <span>{item.text}</span>
              <small>
                {item.done
                  ? "Done"
                  : item.due
                    ? `Due ${new Date(item.due * 1000).toLocaleString()}`
                    : "No reminder"}
              </small>
              <div style={row}>
                {item.target && (
                  <Button
                    onClick={() => {
                      const connection = ctx.relay.snapshot();
                      const scope =
                        connection.scope && splitPartition(connection.scope);
                      if (!scope || !item.target) return;
                      void ctx.navigation
                        .open({
                          version: 1,
                          kind: "conversation",
                          scope,
                          channelId: item.target.channelId,
                          messageId: item.target.eventId,
                        })
                        .then((result) => {
                          if (result.status === "failed")
                            setError(
                              "This message cannot open. The saved item is still here.",
                            );
                        })
                        .catch((error) => setError(String(error)));
                    }}
                  >
                    Open message
                  </Button>
                )}
                {kind === "todo" && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => void save({ ...item, done: !item.done })}
                    >
                      {item.done ? "Reopen" : "Mark done"}
                    </Button>
                    <Button disabled={busy} onClick={() => edit(item)}>
                      Edit
                    </Button>
                  </>
                )}
                <Button
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...item,
                      kind: kind === "saved" ? "todo" : "saved",
                      done: false,
                      due: null,
                    })
                  }
                >
                  Move to {kind === "saved" ? "To-dos" : "Saved"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void save({ ...item, deleted: true })}
                >
                  Remove
                </Button>
              </div>
            </article>
          ))}
        </div>
      );
    }
    ctx.pages.register({
      id: pageId,
      title,
      primary: true,
      placement: "topbar",
      component: function Page() {
        React.useSyncExternalStore(
          ctx.relay.subscribe,
          ctx.relay.snapshot,
          ctx.relay.snapshot,
        );
        const list = currentStore();
        return (
          <section
            aria-label={title}
            style={{
              height: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <header data-buzz-ui="" className="panel-header">
              <div className="panel-header-title">
                <div className="panel-header-label">
                  <h2>{title}</h2>
                </div>
              </div>
            </header>
            <div
              style={{
                overflowY: "auto",
                minHeight: 0,
                padding: "var(--space-panel-inset)",
              }}
            >
              {list ? (
                <List key={currentKey} list={list} />
              ) : (
                <p>Connect to see your list.</p>
              )}
            </div>
          </section>
        );
      },
    });
    ctx.conversation.registerMessageAction({
      id: kind,
      title: kind === "saved" ? "Save for later" : "Add to To-dos",
      placement: "menu",
      matches: (message) => /^[a-f0-9]{64}$/.test(message.id),
      component: function Action({ message, session }) {
        const [error, setError] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        return (
          <>
            <button
              type="button"
              role="menuitem"
              className="buzz-menu-item"
              disabled={busy}
              onClick={() => {
                const list = currentStore();
                if (!list || ctx.relay.snapshot().session !== session) {
                  setError("Connect before saving.");
                  return;
                }
                setBusy(true);
                setError("");
                void (async () => {
                  if (!list.snapshot().loaded) await list.refresh();
                  const existing = list
                    .snapshot()
                    .items.find((item) => item.target?.eventId === message.id);
                  if (existing?.kind !== kind)
                    await list.save(
                      existing
                        ? { ...existing, kind, due: null, done: false }
                        : {
                            ...newItem(
                              kind,
                              message.content.trim().slice(0, 1000) ||
                                "Saved file",
                            ),
                            target: {
                              eventId: message.id,
                              channelId: message.channelId,
                              authorPubkey: message.authorId,
                            },
                          },
                    );
                  const connection = ctx.relay.snapshot();
                  const scope =
                    connection.scope && splitPartition(connection.scope);
                  if (scope)
                    await ctx.navigation.open({
                      version: 1,
                      kind: "plugin",
                      pluginId: "personal.lists",
                      pageId,
                      scope,
                    });
                })()
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              {kind === "saved" ? "Save for later" : "Add to To-dos"}
            </button>
            {error && <span role="alert">{error}</span>}
          </>
        );
      },
    });
  }
};
