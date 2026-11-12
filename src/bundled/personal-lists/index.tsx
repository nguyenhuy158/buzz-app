import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { PluginModule } from "../../plugins/api";
import { scopeOf } from "../reminders/react";
import { messagePreview } from "../../features/notifications/content";
import { MenuItem } from "../../shared/design-system/ui/Menu";
import { useToastNotification } from "../../shared/design-system/ui/Toast";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { NoteIcon } from "../../shared/design-system/icons";
import {
  createStore,
  newItem,
  type PersonalItem,
  type PersonalStore,
} from "./model";
import { PersonalListsPage } from "./PersonalListsPage";

export const inject = ["pages", "relay", "navigation", "conversation"];
const noSubscribe = () => () => {};
const noState = () => undefined;

export const apply: PluginModule["apply"] = (ctx) => {
  const stores = new Map<string, PersonalStore>();
  function currentStore() {
    const connection = ctx.relay.snapshot();
    const scope = scopeOf(connection);
    if (!scope || connection.status !== "ready") return;
    const key = JSON.stringify(scope);
    let store = stores.get(key);
    if (!store) {
      store = createStore(
        async (args) => {
          const current = scopeOf(ctx.relay.snapshot());
          if (!current || JSON.stringify(current) !== key)
            throw new Error("Account changed. Open this list again.");
          return invoke("personal_lists_request", {
            ...args,
            viewer: scope.viewer,
            community: scope.communityOrigin,
          });
        },
        async (items) => {
          if (JSON.stringify(scopeOf(ctx.relay.snapshot())) !== key) return;
          const tasks = items
            .filter(
              (item) => item.kind === "todo" && !item.done && item.due !== null,
            )
            .map((item) => ({ id: item.id, due: item.due }));
          await invoke("personal_lists_schedule", {
            viewer: scope.viewer,
            community: scope.communityOrigin,
            tasks,
          });
        },
      );
      stores.set(key, store);
    }
    return store;
  }
  ctx.effect(() => {
    let active: PersonalStore | undefined;
    const bind = () => {
      const store = currentStore();
      if (store !== active) {
        active = store;
        void store?.refresh();
      }
    };
    const off = ctx.relay.subscribe(bind);
    const timer = setInterval(() => void currentStore()?.refresh(), 60000);
    bind();
    return () => {
      off();
      clearInterval(timer);
      stores.clear();
    };
  });
  for (const kind of ["saved", "todo"] as const) {
    const title = kind === "saved" ? "Saved" : "To-dos";
    ctx.pages.register({
      id: kind === "saved" ? "saved" : "todos",
      title,
      layout: "workspace",
      primary: true,
      placement: "dock",
      component: function Page() {
        const connection = useSyncExternalStore(
          ctx.relay.subscribe,
          ctx.relay.snapshot,
          ctx.relay.snapshot,
        );
        const store = currentStore();
        const notify = useToastNotification();
        if (!store)
          return (
            <EmptyState
              icon={<NoteIcon size={24} />}
              title="Connect to see your list"
            />
          );
        return (
          <PersonalListsPage
            key={`${connection.scope}:${kind}`}
            store={store}
            kind={kind}
            open={(item) => {
              const scope = scopeOf(connection);
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
                    notify(
                      "This message cannot open. Your saved item is still here.",
                      "error",
                    );
                });
            }}
          />
        );
      },
    });
    ctx.conversation.registerMessageAction({
      id: kind,
      title: kind === "saved" ? "Save for later" : "Add to To-dos",
      placement: "menu",
      matches: (message) => /^[a-f0-9]{64}$/.test(message.id),
      marker: function Marker({ message, session }) {
        useSyncExternalStore(
          ctx.relay.subscribe,
          ctx.relay.snapshot,
          ctx.relay.snapshot,
        );
        const store =
          ctx.relay.snapshot().session === session ? currentStore() : undefined;
        const state = useSyncExternalStore(
          store?.subscribe ?? noSubscribe,
          store?.snapshot ?? noState,
          store?.snapshot ?? noState,
        );
        const exists = state?.items.some(
          (item) => item.kind === kind && item.target?.eventId === message.id,
        );
        return exists ? (
          <span
            role="img"
            aria-label={
              kind === "saved" ? "Saved for later" : "Added to To-dos"
            }
            title={kind === "saved" ? "Saved for later" : "Added to To-dos"}
          >
            <NoteIcon size={14} aria-hidden="true" />
          </span>
        ) : null;
      },
      component: function Action({ message }) {
        const notify = useToastNotification();
        return (
          <MenuItem
            onClick={() => {
              const store = currentStore();
              if (!store) {
                notify("Connect before saving.", "error");
                return;
              }
              const existing = store
                .snapshot()
                .items.find((item) => item.target?.eventId === message.id);
              if (existing?.kind === kind) {
                notify(
                  kind === "saved" ? "Already in Saved" : "Already in To-dos",
                  "success",
                );
                return;
              }
              const item: PersonalItem = existing
                ? { ...existing, kind, due: null, done: false }
                : {
                    ...newItem(
                      kind,
                      messagePreview(message.content) || "Saved file",
                    ),
                    target: {
                      eventId: message.id,
                      channelId: message.channelId,
                      authorPubkey: message.authorId,
                    },
                  };
              void store
                .save(item)
                .then(() =>
                  notify(
                    kind === "saved" ? "Saved for later" : "Added to To-dos",
                    "success",
                  ),
                )
                .catch((error: unknown) =>
                  notify(
                    error instanceof Error ? error.message : String(error),
                    "error",
                  ),
                );
            }}
          >
            {kind === "saved" ? "Save for later" : "Add to To-dos"}
          </MenuItem>
        );
      },
    });
  }
};
