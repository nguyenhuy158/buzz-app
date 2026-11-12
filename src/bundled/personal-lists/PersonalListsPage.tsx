import { useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { Input } from "../../shared/design-system/ui/Input";
import { Select } from "../../shared/design-system/ui/Select";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { NoteIcon, ListChecksIcon } from "../../shared/design-system/icons";
import {
  matchesFilter,
  newItem,
  type PersonalItem,
  type PersonalStore,
} from "./model";
import styles from "./PersonalLists.module.css";

export function PersonalListsPage({
  store,
  kind,
  open,
}: {
  store: PersonalStore;
  kind: PersonalItem["kind"];
  open: (item: PersonalItem) => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [editing, setEditing] = useState<PersonalItem | null>(null);
  const [error, setError] = useState("");
  const [clear, setClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const title = kind === "saved" ? "Saved" : "To-dos";
  const Icon = kind === "saved" ? NoteIcon : ListChecksIcon;
  const items = state.items
    .filter(
      (item) =>
        item.kind === kind && matchesFilter(item, filter, Date.now() / 1000),
    )
    .sort((a, b) =>
      sort === "due"
        ? (a.due ?? Infinity) - (b.due ?? Infinity) || b.created - a.created
        : b.created - a.created,
    );
  async function save(item: PersonalItem) {
    setError("");
    try {
      await store.save(item);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
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
    <FullPageSurface aria-label={title}>
      <div className={styles.page}>
        {clear && (
          <AlertDialog
            title={kind === "saved" ? "Clear Saved?" : "Clear done tasks?"}
            description="These items will be removed on all your devices."
            pending={clearing}
            onClose={() => setClear(false)}
            actions={
              <>
                <Button disabled={clearing} onClick={() => setClear(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={clearing}
                  onClick={() => {
                    setClearing(true);
                    void (async () => {
                      for (const item of state.items.filter(
                        (item) =>
                          item.kind === kind && (kind === "saved" || item.done),
                      )) {
                        if (!(await save({ ...item, deleted: true }))) break;
                      }
                      setClearing(false);
                      setClear(false);
                    })();
                  }}
                >
                  Remove items
                </Button>
              </>
            }
          />
        )}
        <PanelHeader
          title={<PanelHeaderLabel title={title} icon={<Icon size={20} />} />}
        />
        <div className={styles.content}>
          <div>
            <Button
              size="sm"
              disabled={
                state.busy ||
                clearing ||
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
          <div className={styles.controls}>
            {kind === "todo" && (
              <Select
                label="Filter"
                value={filter}
                onValueChange={setFilter}
                groups={[
                  {
                    label: "Tasks",
                    options: [
                      { value: "all", label: "All" },
                      { value: "open", label: "Open" },
                      { value: "done", label: "Done" },
                      { value: "overdue", label: "Overdue" },
                      { value: "upcoming", label: "Upcoming" },
                      { value: "none", label: "No reminder" },
                    ],
                  },
                ]}
              />
            )}
            <Select
              label="Sort"
              value={sort}
              onValueChange={setSort}
              groups={[
                {
                  label: "Order",
                  options: [
                    { value: "newest", label: "Newest first" },
                    ...(kind === "todo"
                      ? [{ value: "due", label: "Due date" }]
                      : []),
                  ],
                },
              ]}
            />
            <Button
              size="sm"
              disabled={state.busy}
              onClick={() => void store.refresh()}
            >
              Refresh
            </Button>
            <span role="status">
              {state.busy ? "Syncing…" : state.loaded ? "Synced" : "Not synced"}
            </span>
          </div>
          {kind === "todo" && (
            <form
              className={styles.editor}
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
              <Field label={editing ? "Edit task" : "New task"}>
                <Input
                  value={text}
                  required
                  maxLength={1000}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
              <Field label="Reminder" optional>
                <Input
                  type="datetime-local"
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                />
              </Field>
              <div className={styles.controls}>
                <Button
                  type="submit"
                  size="sm"
                  disabled={state.busy || !text.trim()}
                >
                  {editing ? "Save task" : "Add task"}
                </Button>
                {editing && (
                  <Button
                    size="sm"
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
            <>
              <p>
                Reminders use the last sync on this Mac. Changes on another
                device need a new sync here.
              </p>
              {state.reminderError && (
                <p role="alert">
                  Tasks are saved. Reminders: {state.reminderError}
                </p>
              )}
              <div>
                <Button
                  size="sm"
                  disabled={state.busy}
                  onClick={() => {
                    void invoke("request_notification_access")
                      .then(() => store.refresh())
                      .catch((error: unknown) => setError(String(error)));
                  }}
                >
                  Allow reminders on this Mac
                </Button>
              </div>
            </>
          )}
          {!items.length && (
            <EmptyState
              icon={<Icon size={24} />}
              title={
                state.loaded
                  ? `No ${title.toLowerCase()} here`
                  : "Loading your list"
              }
              description={
                kind === "saved"
                  ? "Use Save for later in a message menu."
                  : "Add a task or use Add to To-dos in a message menu."
              }
            />
          )}
          <div className={styles.list}>
            {items.map((item) => (
              <div className={styles.row} key={item.id}>
                <NavigationItem
                  label={
                    <span className={styles.label}>
                      <span>{item.text}</span>
                      <small>
                        {item.done
                          ? "Done"
                          : item.due
                            ? `Due ${new Date(item.due * 1000).toLocaleString()}`
                            : "No reminder"}
                      </small>
                    </span>
                  }
                  multiline
                  disabled={!item.target}
                  onClick={() => open(item)}
                />
                <div className={styles.controls}>
                  {kind === "todo" && (
                    <>
                      <Button
                        size="sm"
                        disabled={state.busy}
                        onClick={() => void save({ ...item, done: !item.done })}
                      >
                        {item.done ? "Reopen" : "Mark done"}
                      </Button>
                      <Button
                        size="sm"
                        disabled={state.busy}
                        onClick={() => edit(item)}
                      >
                        Edit
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    disabled={state.busy}
                    onClick={() =>
                      void save({
                        ...item,
                        kind: kind === "saved" ? "todo" : "saved",
                        due: null,
                        done: false,
                      })
                    }
                  >
                    Move to {kind === "saved" ? "To-dos" : "Saved"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={state.busy}
                    onClick={() => void save({ ...item, deleted: true })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FullPageSurface>
  );
}
