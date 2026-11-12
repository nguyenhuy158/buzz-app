# Personal Lists

Saved and To-dos for the stock Buzz desktop app. Data syncs through a private Worker and D1.

## Getting started

1. Build with `BUZZ_PERSONAL_LISTS_URL=https://your-worker.example bin/node plugins/personal-lists/build.mjs` from the repo root.
2. In Buzz, open Settings → Plugins. Load the `dist-plugins/personal-lists` folder at the repo root and enable Personal Lists.
3. Open Saved or To-dos. Use a message menu to save a message.

The Worker must allow your Buzz account. The plugin keeps a temporary signing key in memory only.
See [the setup guide](../../docs/personal-lists-plugin.md) for reminders and checks.
