# Personal Lists plugin

This package runs in the stock Buzz desktop app. It adds Saved and To-dos to page navigation and message menus. It does not need the custom Rust commands.

## Build and load

From the repo root:

```sh
BUZZ_PERSONAL_LISTS_URL=https://your-worker.example bin/node plugins/personal-lists/build.mjs
```

The pages appear in the main app navigation. The plugin uses `topbar`, the name used by Buzz 0.7.0-preview.250.1; newer hosts map it to their app dock.

Open Buzz → Settings → Plugins. Load `dist-plugins/personal-lists` and enable Personal Lists. Use the same owner account as the Worker. The host must have `prepareRemoteAgentAuthorization`, `request`, and message actions. A matching command in the app binary alone does not prove all plugin APIs work; test the installed app.

The plugin uses one temporary key in RAM for each account/community session. Buzz signs its owner proof. The Worker verifies this proof and each signed HTTP request. No main account key leaves Buzz. Restarting the plugin creates a new temporary key. The old custom app can still use owner-signed requests. D1 data and table names do not change.

## Mac reminders

```sh
python3 plugins/personal-lists/reminders.py install
```

Then turn on **Use the Mac reminder helper** in To-dos. The helper checks saved schedules every 30 seconds through a user LaunchAgent. It keeps only account, hashed community, task IDs, and times in a private local file. It sends a generic macOS notification through `osascript`; allow its notifications in macOS if needed. No Apple signing key is used.

Reminders use the last successful sync on this Mac. Edits on another device need a new sync here. The helper works while Buzz is closed, but cannot wake a sleeping or powered-off Mac. After wake it attempts reminders up to one day late. Several due tasks produce one alert. An alert is attempted once; an OS error or crash may lose it. A successful command does not prove a visible banner.

Turn the reminder switch off before disabling the plugin or signing out. This clears the helper schedule. The helper has no Buzz sign-out hook while the app is closed. Notifications contain no task text. To stop the helper:

```sh
launchctl bootout gui/$(id -u)/personal.buzz.reminders
```

## Check

```sh
bin/pnpm exec vitest run scripts/personal-sync/worker.test.mjs scripts/personal-sync/plugin-auth.test.mjs src/bundled/personal-lists/model.test.ts
python3 -m unittest discover -s plugins/personal-lists -p 'test_*.py'
```

In stock Buzz, create a task, refresh, restart, and check it remains. Save a message and open its source. Test both themes and keyboard use. Test sync on a second device. Set a reminder two minutes ahead, quit Buzz, and check for a banner. Keep these live checks separate from fixture tests.
