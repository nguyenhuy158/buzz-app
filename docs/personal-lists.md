# Personal Saved and To-dos

This fork adds two pages to Buzz Desktop. Use the same Buzz account and this
build on each Mac. The normal mobile and desktop apps do not have these pages.

- In a message menu, choose **Save for later** or **Add to To-dos**.
- Open **Saved** or **To-dos** from the dock. Open an item to return to its message.
- Add a task, set a reminder, mark it done, or move it between the two pages.
- Use **Clear Saved** or **Clear done tasks** to remove many items. Buzz asks first.
- Use **Refresh** to get changes now. Buzz also syncs once a minute while connected.

## Data and access

The Worker uses the existing D1 database `db`. Its tables are `buzz_items` and
`buzz_migrations`. Each item belongs to one account and one community. Other
tables are not used. Message text and task text are stored in D1; this is not
end-to-end encrypted storage. Files stay in the original message.

The desktop host signs each request with the Buzz key. The Worker checks the
signature, URL, method, body hash, and time. `BUZZ_OWNER` allows one public key.
Cloudflare tokens stay outside the app. A stale edit fails instead of replacing
a newer edit. Deleted rows remain as small records to block old writes.

Changes need a network connection. A failed save keeps the input so it can be
tried again. If the reply is lost after a save, refresh before trying again.
The list stays in memory while the app runs; there is no offline edit queue.

## Reminders on Mac

Choose **Allow reminders on this Mac**. A bundled app and macOS permission are
needed. Development builds may need `BUZZ_DEV_SIGNING_IDENTITY`, as described
in the existing desktop build guide.

macOS keeps future reminders after Buzz closes. Alerts show a generic message;
open To-dos to see the task. Keep at most 64 future reminders on each Mac.
Completed, moved, and removed tasks have their pending alerts cancelled after
sync. Signing out cancels pending personal alerts on this Mac.

A closed app cannot fetch changes from another device. Its alerts use the last
sync on that Mac. Open Buzz and refresh to update them. A task added on another
device while this Mac's app is closed will not alert here until a sync. Past
reminders remain visible in the list; they are not sent again on launch.

## Deploy and build

Use an existing Cloudflare credential with Worker and D1 access. Do not add the
token to source files or the desktop build. The config has this fork's public
owner key and shared database ID.

```sh
wrangler d1 migrations apply db --remote --config scripts/personal-sync/wrangler.jsonc
wrangler deploy --config scripts/personal-sync/wrangler.jsonc
BUZZ_PERSONAL_LISTS_URL=https://buzz-personal-sync.huycode.workers.dev bin/just desktop-bundle
```

The endpoint is set at build time. A build without it shows a setup error and
does not send requests. The web host does not support the native sync or Mac
reminder commands.

## Checks and rollback

```sh
bin/pnpm exec vitest run scripts/personal-sync/worker.test.mjs src/bundled/personal-lists/model.test.ts
bin/pnpm typecheck
bin/cargo check --manifest-path src-tauri/Cargo.toml --lib
```

The UI fixture is `/tests/fixtures/personal-lists.html` on `bin/just web`.
It uses sample data and the real page components. It does not prove D1 sync or
macOS notification delivery. Test two signed-in Macs and an alert after Quit
before treating those paths as verified.

To roll back, use the previous desktop build and Worker version. Keep the D1
tables and data. Do not drop shared database tables.
