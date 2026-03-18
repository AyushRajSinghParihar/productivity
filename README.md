# Focus Board 🎯

A fullscreen personal focus dashboard. Shows your current task in giant all-caps with a live countdown timer.

## Pages

| Route | What it does |
|-------|-------------|
| `/` | **Dashboard** — fullscreen display, big task name, countdown |
| `/manage` | **Planner** — add/edit today's tasks with durations |

## Quick Start

```bash
npm install
npm run dev
# open http://localhost:3000/manage
```

## Deploy to Vercel (2 minutes)

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo
3. Leave all settings as default → click **Deploy**
4. Done. Your URL is live.

## How to use

1. Go to `/manage`
2. Type your tasks (or **paste a list from Notion** — it auto-splits by line!)
3. Set duration (minutes) for each task — hover a row to reveal controls
4. Hit **Start Session**
5. Open `/` on your second laptop — it stays fullscreen forever

## Features

- **Notion paste** — copy 5 tasks from Notion, paste once → 5 rows appear instantly
- **Keyboard nav** — Enter to add task, Backspace on empty to delete, ↑↓ to move between
- **Live progress bar** at top of dashboard
- **Turns red** in the last 2 minutes of a task
- **Auto-advances** to next task when timer hits zero
- All data stored in `localStorage` — no backend, no account needed
