import "../../src/shared/styles/globals.css";
import * as React from "react";
import { createRoot } from "react-dom/client";
import type { MessageAction } from "../../src/plugins/author";
import { IconButton } from "../../src/shared/design-system/ui/IconButton";
import { newItem } from "../../src/bundled/personal-lists/model";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.colorMode = params.get("theme") ?? "light";
document.documentElement.style.setProperty(
  "--buzz-text-scale",
  params.get("scale") ?? "1",
);
const viewer = "a".repeat(64);
const connection = {
  status: "ready",
  viewer,
  scope: `wss://example.org:${viewer}`,
  session: {},
};
let items = [
  { ...newItem("todo", "Review the plugin"), revision: 1, created: 1 },
  { ...newItem("saved", "Weekend project notes"), revision: 1, created: 2 },
];
const pages: { id: string; title: string; component: React.ComponentType }[] =
  [];
const actions: MessageAction[] = [];
let writes = 0;
const plugin = await import("../../dist-plugins/personal-lists/plugin.js");
plugin.apply({
  react: React,
  effect: (effect: () => unknown) => effect(),
  pages: { register: (page: (typeof pages)[number]) => pages.push(page) },
  relay: { snapshot: () => connection, subscribe: () => () => {} },
  conversation: {
    registerMessageAction: (action: MessageAction) => actions.push(action),
  },
  navigation: { open: async () => ({ status: "opened" }) },
  host: {
    prepareRemoteAgentAuthorization: async () => [
      "auth",
      viewer,
      "",
      "fixture",
    ],
    request: async (request: { body?: string }) => {
      if (request.body) {
        if (params.has("hold"))
          await new Promise<void>((resolve) =>
            window.addEventListener("release-save", () => resolve(), {
              once: true,
            }),
          );
        writes++;
        document.documentElement.dataset.saveRequests = String(writes);
        if (params.has("fail") && writes === 1)
          return { status: 503, body: JSON.stringify({ error: "Try again" }) };
        const item = JSON.parse(request.body);
        const saved = {
          ...item,
          revision: item.revision + 1,
          created: item.created || Date.now() / 1000,
        };
        items = [...items.filter((row) => row.id !== saved.id), saved];
        return { status: 200, body: JSON.stringify({ item: saved }) };
      }
      return { status: 200, body: JSON.stringify({ items, cursor: null }) };
    },
  },
});
function Fixture() {
  const [action, setAction] = React.useState<MessageAction>();
  const Action = action?.component;
  const [selected, select] = React.useState("todos");
  const Page = pages.find((page) => page.id === selected)?.component;
  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <nav
        style={{
          display: "flex",
          gap: "var(--space-3)",
          padding: "var(--space-3)",
        }}
      >
        <span>Plugin fixture · sample data</span>
        {pages.map((page) => (
          <button type="button" key={page.id} onClick={() => select(page.id)}>
            {page.title}
          </button>
        ))}
      </nav>
      <section
        aria-label="Sample message"
        style={{ padding: "var(--space-3)" }}
      >
        <p>Sample message for toolbar checks</p>
        <fieldset aria-label="Message actions">
          {actions
            .filter(
              (item) =>
                item.placement === "toolbar" &&
                item.matches(
                  { id: "b".repeat(64) } as never,
                  connection.session as never,
                ),
            )
            .map((item) => (
              <IconButton
                key={item.id}
                size="sm"
                title={item.title}
                aria-label={item.title}
                icon={item.icon ? <item.icon /> : <span />}
                onClick={() => setAction(item)}
              />
            ))}
        </fieldset>
        {actions.map(
          (item) =>
            item.marker && (
              <item.marker
                key={item.id}
                message={{ id: "b".repeat(64) } as never}
                session={connection.session as never}
              />
            ),
        )}
        {Action && (
          <React.StrictMode>
            <Action
              key={action.id}
              message={
                {
                  id: "b".repeat(64),
                  content: "Sample message for toolbar checks",
                  channelId: "c".repeat(64),
                  authorId: viewer,
                } as never
              }
              session={connection.session as never}
              close={() => setAction(undefined)}
              canOpen={() => true}
              open={() => true}
            />
          </React.StrictMode>
        )}
      </section>
      <Page key={selected} />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
