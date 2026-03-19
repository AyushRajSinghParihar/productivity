# Focus Board

A fullscreen personal focus dashboard. Shows your current task in giant all-caps with a live countdown timer.

## Pages

| Route | What it does |
|-------|-------------|
| `/` | **Dashboard** — fullscreen display, big task name, countdown, session history |
| `/manage` | **Planner** — add/edit/reorder today's tasks with durations |

## Quick Start

```bash
npm install
npm run dev
# open http://localhost:3000/manage
```

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo
3. Leave all settings as default → click **Deploy**
4. Done. Your URL is live.

## How to use

1. Go to `/manage`
2. Type your tasks (or **paste a list from Notion** — it auto-splits by line!)
3. Set duration (minutes) for each task — hover a row to reveal controls
4. Hit **Start Session** (or press `Cmd/Ctrl+Enter`)
5. Open `/` on your second monitor — it stays fullscreen forever

## Features

### Core
- **Live countdown timer** with fullscreen task display
- **Progress bar** at top of dashboard
- **Turns red** in the last 2 minutes of a task
- **Auto-advances** to next task when timer hits zero
- **Skip task** button to jump to the next task
- **Pause / Resume** — freeze the timer mid-task and pick up where you left off
- **Take a Break** — enter a manual break mode (no countdown, resume when ready)
- **Task checkmarks** — mark tasks as completed manually or auto-complete on timer expiry
- **Optional break intervals** — configurable timed breaks between tasks (enable in settings)
- **Confirm before reset** — dialog prevents accidental session loss

### Notifications
- **Audio notification** — beep sound when a task's time runs out (Web Audio API)
- **Screen flash** — visual flash on task completion
- **Tab title countdown** — see remaining time in your browser tab without switching

### Task Management
- **Drag-and-drop reordering** on the manage page
- **Time-range or duration** — set task length in minutes, or type a start/end time (e.g., "2pm", "1330", "9") and duration auto-calculates
- **Planned start time** — set when your day starts on the first task, all other times cascade
- **Notion paste** — copy 5 tasks from Notion, paste once → 5 rows appear instantly
- **Keyboard nav** — Enter to add task, Backspace on empty to delete, Arrow keys to navigate
- **Auto-redirect** — `/` sends you to `/manage` when no tasks exist

### Customization
- **Dark / Light theme** — toggle from the toolbar
- **Focus day rollover** — configurable hour (default 4 AM) so late-night work still counts as the same day
- **Settings panel** — gear icon in top-right corner

### Data
- **Session history** — tracks completed sessions, viewable on the dashboard
- **Mass reset** — clear all data from settings → Danger Zone
- All data stored in `localStorage` — no backend, no account needed

## Tech Stack

- Next.js 14 (App Router)
- React 18
- Tailwind CSS 3
- @dnd-kit (drag-and-drop)
