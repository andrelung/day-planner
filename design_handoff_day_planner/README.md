# Handoff: Day Planner (pre-planning app for Asana + Outlook)

## Overview
A mobile web app that helps people at a creative agency pre-plan their upcoming days. It sits alongside Asana (tasks) and Outlook (calendar) — it does not replace either. Core loop: triage overdue/unplanned Asana tasks one at a time, decide when realistically to do them (today, later, or split into a smaller part), see how full each day already is, and reconcile unlinked Outlook calendar events with Asana tasks. All "commit" actions are meant to write back to Asana (due date, duration) — the prototype simulates this with a toast message; there is no real Asana/Outlook API integration yet.

## Product briefing (verbatim from the stakeholder)
This is the source requirements brief this design was built from. Treat it as the authoritative spec — the screen-by-screen description below is one implementation of it; where the current prototype simplifies or mocks something, that is called out explicitly in "Known gaps vs. this briefing" further down.

> I want to create a (Web-)App for mobile devices. The app should help in pre-planning the tasks and time allotment within an creative agency. Currently we use asana for tasks and microsoft outlook for appointments. Both should be used as data sources. All changes to due dates and task-durations should be written back to asana.
>
> Our main purpose for the app is to help an employe in pre-planning the upcoming days. A day is well planed, if the scope of the day is doable. A day with 10+ is considered undoable. Usually the steps involved are:
> - look at every single tasks
> - get a sense of how much time is left in the upcoming days
> - identify and remove low-priority tasks (either by postponing them to a later date or by removing their due-date)
> - realistically plan the upcoming day(s) by paying attention to how many work is even possible
> - prioritise important or time-critical tasks
> - Make sure a day is within the employees maximum capacity
>
> it will help if the user is able to:
> - see to which date a task is moved (in a sense of "knowing how busy that day is"), because this will reduce planning effort in the near future ("pre-pre-planning")
> - get visual clues when a day gets overloaded (less doable based on a personal reference or past performance)
> - adjust the needed time for task completions (effort/duration)
> - divide work if necessary - in asana logic, this is done by creating sub-steps (sub-tasks) from a given task
> - create tasks for calendar-appointments (this is our way of connecting the worlds of asana-task-management and the outlook-time-management)
> - link/redirect to the asana app in case you need to make more sophisticated edits to a given task
>
> the app absolutely does not need to:
> - replace the asana app (most people will have both apps installed and will use them for different purposes)
> - create entirely new tasks without context
> - create or edit task description (a link to the asana-app/-website will suffice)
> - be used to actually *do* the work; this will always be done within the asana platform, because it is way more tested and feature-rich and up-to-date - the app should only help in pre-planning
>
> Logic:
> - Tasks are collected from Asana
> - Calendar entries and availability is collected from Office 365
> - The app should have OAuth logins for both and store the tokens
> - If possible use one of the logins as primary app login and store the other token within that account
> - A task is "unplanned" if it has no time assigned or if it is doubled
> - The interface loops through incomplete tasks via their due dates. If nothing is selected, the user starts with the task with the earliest due date. Also overdue tasks are considered.

## Known gaps vs. this briefing (things the prototype mocks or simplifies)
- **OAuth / token storage**: the briefing calls for real OAuth logins to both Asana and Office 365, with tokens stored, and one login used as the primary app account holding the other provider's token. The prototype's Integrations screen only toggles a mock "Connected" state — no real auth flow, token storage, or primary/secondary account linking exists yet. This needs real design + engineering before build.
- **"Unplanned" definition**: the briefing defines a task as unplanned if it has *no time assigned or if it is doubled* (double-booked). The prototype currently treats "Unplanned" as purely "no due hour set," and its double-booking flow ("Double-book anyway" on the Slot conflict screen) lets the conflicting booking stand without reverting either task to "unplanned." The real product should flip a task back to Unplanned when it becomes doubled.
- **"10+ hours is undoable"**: the briefing gives a concrete threshold. The prototype instead uses a generic per-day `{ planned, capacity }` pair (capacity defaults to 8h on weekdays, 40h for "next week") to decide when a day is full/overloaded. The real capacity number should likely come from the employee's actual working hours / historical throughput rather than a hardcoded constant, per "based on a personal reference or past performance."
- **Queue ordering / starting task**: the briefing specifies the task loop should be ordered by due date, starting from the earliest due date (including overdue) when nothing else is selected. The prototype's queue is currently just the seed array order with manual prev/next stepping — it is not sorted by due date. This should be implemented as a real sort.
- **Live data sources**: all tasks, calendar events, and workload numbers are static mock data written into the prototype. There is no live Asana or Microsoft Graph (Outlook) API call.

## About the design files
The file in this bundle (`Day Planner.dc.html`) is a **design reference built in HTML/React**, not production code to copy directly. It runs entirely in the browser with mock in-memory data (no backend, no real Asana/Outlook calls). The task is to **recreate this design and behavior in the target codebase's real environment** — the user has stated a preference for **TypeScript**, and has **no React experience**, so do not assume the implementation must be React; a plain TypeScript/DOM approach, or another framework the team already uses, is equally valid. Use this document (not the HTML source) as the spec.

## Fidelity
**High-fidelity.** Colors, type, spacing, component styles, and copy are final-intent (drawn from the bound "Grips IO" design system tokens — see Design Tokens below). Layout proportions and interaction sequencing are final-intent; only the backend/data layer is a stand-in.

## Global layout
- Single-column mobile viewport, full device width/height (100vw / 100dvh), no outer chrome, no status bar mockup.
- One "screen" is visible at a time; navigating between them is a full replace (no stacked modals), implemented as client-side view-state, not routing/URLs.
- Base font: Open Sans (400/700/800 weights). Headings: 22px extrabold. Card/section titles: 18px bold. Body/buttons: 15px. Meta/list text: 13px. Dense list rows (Up next, calendar search results): 11–13px.
- A toast/snackbar (dark navy pill, white bold text, 13px) appears pinned near the **top** of the screen for ~2.6s after any committing action, to avoid covering bottom controls.

## Screens

### 1. Triage (home)
**Purpose:** Work through overdue/unplanned tasks one at a time; decide what happens to each.

**Layout (top to bottom):**
- Header row: settings icon button (top-left, opens Settings), page title "Plan your day" (centered, 16px bold), overview icon button (top-right, opens Overview).
- **Up next list** (scrollable, takes remaining vertical space): section label "UP NEXT" (11px, uppercase, muted). Each row: a small dot (red if the task has a due hour set, i.e. is overdue; grey otherwise) — task name (13px bold, truncated to one line) and project (11px muted) — an hour estimate on the right (e.g. "4h") with a small pencil icon. Tapping the row (outside the hour label) makes that task the focus card. Tapping the hour label/pencil expands an inline editor in place: a stepper (−, numeric input, "h", +) and a Save button.
- **Queue position row**: small caption "Task N of M to plan" with previous/next chevron icon buttons that step through the queue (disabled/dimmed when only one task remains).
- **Focus card** (the task currently being triaged): sits near the bottom of the screen, close to the thumb.
  - Two full-bleed color panels sit behind the card and are revealed by horizontal drag: navy on the left labeled "Plan later", yellow on the left... (yellow reveal is right-aligned) labeled "Plan today". Dragging the card right past ~90px commits to "Plan today"; left past ~90px commits to "Plan later"; releasing short of the threshold snaps back. Buttons on the card are unaffected by the drag gesture (pointer-down on a `<button>` is ignored by the drag handler).
  - Card content: a status pill ("Overdue · 09:00" in red/wrong tone when the task has a due hour, or "Unplanned" in neutral tone when it has none) and an "open in Asana" icon button (top-right of the card).
  - Task name (18px bold), project (13px muted).
  - "Estimate" row: shows the current hour estimate with a pencil; tapping opens the same inline stepper+input editor as the list rows.
  - Two primary action buttons side by side: **Plan later** (secondary/navy) and **Plan today** (primary/yellow).
  - Below that, two smaller ghost buttons side by side: **Split into a part** and **Remove due date**.
  - **Empty state** (all tasks resolved): a green check icon, "All caught up", "Nothing left to plan right now."
- **Floating capacity badge**: a circular badge fixed near the bottom-right corner, showing "{planned}/{capacity}h" for today. Red background when planned ≥ capacity (overloaded), green otherwise. Tapping it opens Overview.

**Data shown:** 30 seeded tasks (name, project, hour estimate, optional due hour). ~10 have a due hour (rendered as "Overdue"); the rest are "Unplanned".

### 2. Settings
Reached via the header's left icon. Full-screen, light background, close (X) top-right.
- Input: "Preferred starting time" (time picker)
- Input: "Preferred end of workday" (time picker)
- Input: "Buffer between tasks (minutes)" (number, default **10**) — accounts for set-up/context-switch time between tasks
- Row: "Asana & Outlook" (chevron) → opens Integrations
- Muted italic line: "More to come" (placeholder for future settings)

### 3. Integrations
Reached from Settings. Back arrow (top-left), heading "Connect Asana & Outlook", subtitle "Manage tasks, meet deadlines, and access real-time updates to boost productivity."
- Row: Asana — square avatar placeholder with "A" monogram (no real logo asset was available), title "Asana Account", description "Connect your Asana account to sync tasks", and a **Connect** button (disconnected by default in the mock).
- Row: Outlook — square avatar placeholder with "O" monogram, title "Outlook Account", description "Connect your Outlook calendar to sync free slots", shows plain **Connected** label (connected by default in the mock, no action needed).
- Tapping Connect flips that integration to "Connected" and shows a toast. No real OAuth/API call exists.

### 4. Overview
Reached from the header icon or the floating capacity badge. Close (X) top-right.
- **"Workload by day"**: one row per day (Today, Tomorrow, Wednesday, Thursday, Next week). Each shows the day label, a "{planned}/{capacity}h" figure (red text when overloaded, muted grey otherwise), and a horizontal progress bar (red fill when planned ≥ capacity, green fill otherwise, width = min(100%, planned/capacity)).
- **"From your calendar"**: Outlook calendar events that are not yet linked to an Asana task. Each row: event title, time. Two actions: **Link to task** and **Add as task**. Tapping either opens an inline search panel in place (title changes to "Link to a task" or "Add to project or subtask", a Cancel link, a search input, and a scrollable result list):
  - *Add as task* results mix two kinds: existing **projects** (deduplicated from current tasks) — picking one creates a new task under that project — and existing **tasks** tagged "Subtask of" — picking one creates the new task as a subtask of that task (its project field becomes `Subtask of "<parent name>"`).
  - *Link to task* results are existing tasks only — picking one marks the calendar event as linked to that task (no new task is created).
  - After either action, the event's row collapses to just its title + "{time} · linked to \"<name>\"" and the action buttons disappear.

### 5. Plan today (yellow)
Reached from the focus card's "Plan today" button or a right-swipe. Full yellow background (this matches the "Plan today" swipe-reveal color). Close (X) top-right (dark icon/border for contrast on yellow).
- Title "Free slots today", subtitle "<task name> · needs <hours>h".
- A list of free-slot cards (white, e.g. "13:00–13:30") pulled from the (mock) Outlook calendar, plus a "Pick a time" card that expands into a time input + "Confirm time" button.
- Tapping a slot (or confirming a custom time) commits the task to today at that time — unless there's a **conflict** (see Slot conflict, below).
- Footer: **back** button (returns to Triage).

### 6. Plan later (navy)
Reached from the focus card's "Plan later" button, a left-swipe, or automatically after splitting a task into a part (see Split flow) when the original task still has remaining hours. Full navy background (matches the "Plan later" swipe-reveal color).
- Title "When later?", subtitle "<task name> · needs <hours>h".
- One row per day (Tomorrow, Wednesday, Thursday, Next week), each showing a workload badge ("{planned}/{capacity}h", red/"wrong" tone if that day is already at or over capacity, green/"correct" otherwise). Tapping a day that is NOT full goes to Free slots (later); tapping a day that IS full goes to the **Day full** screen first.
- Row: "Pick a date" → date-picker screen → Free slots (later).
- Footer: **back** and **Remove due date** (removes the task from the queue entirely, simulating clearing its Asana due date).

### 7. Pick a date
Simple date input + Continue button (disabled until a date is chosen) on the same navy background as Plan later. Continuing goes to Free slots (later) labeled with the chosen date.

### 8. Free slots (later)
Same pattern as "Plan today" but themed navy, for whichever day was chosen (preset or custom date). Slot list is a small mocked set that varies by day. Footer: **back** (returns to Plan later).

### 9. Day full
Interrupts the flow when the user tries to plan into a day that is already at/over capacity (checked both for "today" and for any later-day row). Light background, warning triangle icon, "{Day} already looks full", "{planned}/{capacity}h already planned".
- **Plan for this day anyway** (primary) → proceeds to the slot picker for that day as normal.
- **Review other tasks on this day** (ghost) → does **not** open a separate screen; it simply returns to the ordinary Triage loop with the queue pointer reset to the first task, so the user re-enters the normal review flow instead of committing to the full day.

### 10. Slot conflict
Interrupts committing a specific time slot (in Plan today, Free slots later, or the Split-into-a-part time step) if that exact slot string is already occupied by another item already planned for that day. Same visual pattern as Day full (warning icon, light background), listing the conflicting item(s) by name and hours, "{slot} is already booked".
- **Choose another time** (primary) → returns to the slot list the user came from.
- **Double-book anyway** (ghost) → commits the original selection despite the conflict.

### 11–14. Split into a part (4-step wizard)
Reached via "Split into a part" on the focus card. All four steps: white background, close (X) top-right (returns straight to Triage), heading "Do a part today", navy footer bar with a **back** button that steps to the previous step.
1. **Name the part** — text input, placeholder "e.g. Draft outline"; a circular yellow arrow button (dimmed/inert until text is entered) continues.
2. **When are you planning to do it?** — list of today's free slots (outlined boxes, not filled) — picking one may trigger the Slot conflict screen if that time is already taken.
3. **How long do you need?** — stepper (−, numeric input, "h", +), default 1h, then a circular yellow arrow button continues.
4. **Confirm** — shows the part's name, chosen time, and duration; **edit** (back to step 1) and **create** (commits) side by side.

Committing: creates the part as a scheduled item today (added to today's workload and to the day's planned-items list), and reduces the original task's remaining hours by the part's duration.
- If the original task still has hours remaining after the split, the app **reopens the Plan later screen** for that same (now-reduced) task, so the user immediately decides when to do the rest — this is a loop back into screen #6, not a new screen.
- If the split fully consumes the task's hours, the task is removed from the queue and the app returns to Triage.

## State & data model (for reference — the real backend replaces this)
- **Task**: id, name, project, hours (estimate, editable in 0.5h steps via any stepper), dueHour (`"HH:MM"` string or `null` — presence of a due hour is what makes a task "Overdue" instead of "Unplanned").
- **Day workload**: for Today and for each of the 4 relative "later" buckets (Tomorrow/Wednesday/Thursday/Next week), a `{ planned, capacity }` pair in hours. "Full" = planned ≥ capacity.
- **Planned-items log** (`plannedByDay`): per day, a list of `{ name, hours, slot }` entries — used to detect slot conflicts (matches on exact `slot` string) and seeded with a couple of baseline "already on the calendar" items per day so the app isn't empty on first load.
- **Calendar events**: title, time label, linked (bool) + linked task name once resolved.
- Settings: preferred start time, preferred end of workday, buffer-between-tasks minutes (default 10). Not yet wired to any scheduling logic — captured as intent for the next iteration.
- Asana/Outlook connection flags (mock booleans).

## Interactions & behavior summary
- Drag-to-swipe on the focus card (with equivalent tap buttons as the reliable fallback).
- Tap-to-expand inline editors (hour estimate, calendar search-and-link panel) instead of dialogs, to keep everything in one continuous scroll.
- Every commit action (plan today/later, split, remove due date, add/link calendar event, connect integration) shows a toast confirming the change and, in the real product, should fire the corresponding Asana/Outlook write.
- No animation/transition system beyond a simple drag-follow transform on the focus card; screen changes are instant.

## Design tokens (Grips IO design system)
- Colors: dark navy `#16203C` (ink, "Plan later"/navy screens, buttons), near-white `#F7FCFF` (page background), yellow `#FFD80A` (primary CTA + "Plan today" screens), magenta `#E2005F` (feedback/"wrong"/overdue), olive `#A0C601` (feedback/"correct"), plus neutral greys `#73798A`/`#ABAEB9`/`#D6D7DC` for muted text/borders.
- Type: Open Sans, weights 400/700/800.
- Radius: 6px (`--radius-md`, used almost everywhere), 4px small, pill (999px) for the capacity badge and status pills.
- Elevation: flat/border-led; soft shadow only on the floating capacity badge and the phone-viewport container.
- Full palette, spacing scale, and component source live in the bound "Grips IO Design System" — ask the design system owner for the token files if the target codebase needs to reference them directly.

## Assets
No photography, logos, or custom icon set were available. All icons in the prototype are hand-drawn inline SVGs (simple line-icon style: menu, grid, chevrons, x, plus/minus, pencil, external-link, warning triangle, check-circle, arrow) — not a licensed icon font. The Asana/Outlook "logos" in Integrations are plain letter-monogram placeholders (real brand marks were not available) — swap in real product icons before shipping.

## Files
- `Day Planner.dc.html` — the full interactive prototype (single self-contained file; open directly in a browser). This is the primary reference for exact copy, spacing, and state transitions — read it alongside this README, but do not ship it as-is.
