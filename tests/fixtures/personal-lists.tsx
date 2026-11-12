import "../../src/shared/styles/globals.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PersonalListsPage } from "../../src/bundled/personal-lists/PersonalListsPage";
import { createStore, newItem } from "../../src/bundled/personal-lists/model";
import { Button } from "../../src/shared/design-system/ui/Button";
import { ToastProvider } from "../../src/shared/design-system/ui/Toast";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.colorMode = params.get("theme") ?? "light";
document.documentElement.style.setProperty(
  "--buzz-text-scale",
  params.get("scale") ?? "1",
);
let items = [
  {
    ...newItem("saved", "Design notes for the weekend project"),
    revision: 1,
    created: 2,
  },
  {
    ...newItem("todo", "Review the draft"),
    revision: 1,
    created: 1,
    due: Math.floor(Date.now() / 1000) + 7200,
  },
  {
    ...newItem("todo", "Read the setup guide"),
    revision: 1,
    created: 3,
    done: true,
  },
];
const store = createStore(async ({ item }) => {
  if (item) {
    const saved = {
      ...item,
      revision: item.revision + 1,
      created: item.created || Math.floor(Date.now() / 1000),
    };
    items = [...items.filter((row) => row.id !== saved.id), saved];
    return { status: 200, body: { item: saved } };
  }
  return { status: 200, body: { items, cursor: null } };
});
await store.refresh();

function Fixture() {
  const [kind, setKind] = useState<"saved" | "todo">("todo");
  return (
    <ToastProvider>
      <main className="flex h-screen flex-col gap-4 p-4">
        <div className="flex gap-3">
          <span>Local fixture · sample data</span>
          <Button onClick={() => setKind("saved")}>Saved</Button>
          <Button onClick={() => setKind("todo")}>To-dos</Button>
        </div>
        <PersonalListsPage
          key={kind}
          store={store}
          kind={kind}
          open={() => {}}
        />
      </main>
    </ToastProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
