# Twitch Mon (Web)

A static Next.js web app that authenticates with Twitch via OAuth (Implicit flow) and uses the Helix API to provide:

- Overview of a selected channel
- Viewer charts with sessionization (live and historical)
- Chatters (moderator:read:chatters)

This document explains how the web app behaves, which Twitch API endpoints are used, how charts are implemented, the storage model, and how sessions are managed.

## Table of contents

- Architecture & build
- Authentication & Redirect URI
- Channel selection
- Charts: behavior and implementation
- Chatters: behavior and implementation
  - Chatters flow chart (arrivals/departures)
- Session management
- Local storage format (per-channel)
- Chatters storage model
- Twitch API usage
- Timezone handling
- Auto-resume, peeks, and navigation behavior
- Developing locally & deploying to GitHub Pages
 - Duration distribution (Chatters)
 - Export/Import (Chatters presence + sessions)
 - Clearing chatter and sessions (per channel)
 - Multi-tab storage behavior

## Architecture & build

- Next.js (pages router), built as a static SPA.
- ECharts for data visualization.
- Radix UI Themes for UI controls.
- All state is client-side only; data is stored in browser localStorage.
- No backend is required for the web app.

## Authentication & Redirect URI

- OAuth flow: Implicit Grant (response_type=token).
- The app builds the redirect URI at runtime:
  - Local dev: http://localhost:3000/callback/
  - GitHub Pages: https://<user>.github.io/<repo>/callback/
  - Or origin + NEXT_PUBLIC_BASE_PATH + /callback/
- The Redirect URI is shown read-only on the Home page for reference.
- Scopes requested:
  - user:read:email
  - moderator:read:chatters
  - moderator:read:followers
  - channel:read:subscriptions

Notes:
- Redirect path is always /callback/ (with trailing slash).
- The app stores the access token in memory (per session) after redirect.

## Channel selection

- The selected channel (by login name) is shared across pages using settings persisted to localStorage (see settings storage).
- When returning to a page, the app reads the selected channel and loads the per-channel datasets accordingly.

## Charts: behavior and implementation

- Primary chart: viewer count over time.
- Secondary bar chart: delta (change) in viewers per sample.
- Offline periods are represented by null samples to break the line; these gaps are visually shaded.
- Live updates:
  - While the poller is running and the channel is online, new points append to the active session (see sessions) and update the chart immediately if you are viewing that session.
- Viewing historical sessions:
  - Selecting a past session loads its stored samples and displays them without being affected by current live polling.
- OFFLINE chip:
  - Shown only when the poller is running and the channel is offline.
  - Selecting OFFLINE clears the chart (no data shown), useful as an explicit offline state.

### Implementation details

- ECharts is initialized lazily in the browser and immediately provided a base option (axes/grid/series).
- After init and after each update, the chart instance performs resize() to avoid blank canvas issues on navigation.
- Series data:
  - Viewers: line with area, connectNulls toggled by user setting.
  - Delta: bar series; null samples render as transparent to preserve gaps.
- Gap highlighting:
  - When a time gap exceeds ~1.5× the polling interval, a placeholder {x, y: null, gap: true} is injected and rendered as a shaded markArea.

## Chatters: behavior and implementation

- Primary chart: per-user presence timeline recorded continuously (online and offline).
- Visualization:
  - Each chatter is a row; horizontal bars indicate intervals when the user is present in the current chat list.
  - Rows are ordered with present users first (longest current duration → latest visit → login), then not-present users (latest visit → login).
  - Filter modes: "In chat now" (only present users) and "All users" (present first, then not-present). In "All users", not-present bars are colored orange.
  - Tooltips show start → end and duration for each interval.
  - X-axis is time. OFFLINE default window shows ~last 3 hours; session chips only change the visible window.
  - A thin "Present count (overview)" line overlays the timeline, always on top, with a subdued gray color.
- Interaction:
  - Session chips mirror the viewers chart: OFFLINE (when not live), the active LIVE session, and up to 5 recent finished sessions.
  - Selecting a session only sets the time window on the x-axis. Data is not filtered; pre/post-online presence remains visible in the window.
  - Hovering a user highlights all of their intervals in the time window using a separate, silent overlay layer so tooltips still come from the underlying intervals. The gray session background is non-interactive (no tooltips).
- Timezone:
  - Uses the same timezone control as charts. "System" uses the browser tz; supports search, aliases (e.g., PST → America/Los_Angeles), and recents.
- Live updates:
  - Polls Helix Get Chatters every ~5s (paged, safety cap 10 pages). When a user appears, a new segment opens; when they disappear, the segment is closed with an end timestamp. Open segments render to "now".
- Sessionization:
  - Live session id comes from Get Streams (`stream.started_at`). Session chips are used purely for navigation of the time window; recording continues regardless of online status.
- Rendering details:
  - Implemented with an ECharts custom series that renders rectangles per interval, with universal transitions and resize on mount/update.

### Chatters flow chart (arrivals/departures)

- Secondary chart below the timeline shows room churn per poll (not a net delta):
  - Green bars: arrivals (number of users whose interval opened that poll).
  - Red bars: departures (number of users whose open interval closed that poll), rendered as negative bars (downwards).
- Tooltip on bar hover shows timestamp, +in / -out counts, net, and the list of names arriving/leaving.
- Shares the same x-axis window as the timeline.
- Fit mode: when enabled, both charts auto-fit to the data extent with padding and remain fitted across updates/reloads.

## Duration distribution (Chatters)

- A histogram of per-user durations within the current visible time window.
- Fixed to 30 bins spanning the window.
- Shows two reference markers:
  - Mode: the center of the most-populated bin (solid black label).
  - Mean: average duration across users (dashed black label).
- Uses epoch ms for math; labels use the current timezone setting.

## Session management

- Session definition: a contiguous online period. A session begins when Twitch `Get Streams` reports the channel online and ends when it goes offline.
- Session ID: the Twitch `stream.started_at` ISO timestamp (UTC). This is stable per live session.
- Live session detection:
  - A session is created only when `started_at` is present.
  - While live and polling is running, points append to the active session.
  - We do not create or append points while the channel is offline.
- Live UI:
  - The active session chip shows "<start>: LIVE" only when polling is running and the channel is online.
  - If the channel goes offline while running, the chip loses ": LIVE" and an OFFLINE chip appears.
- Navigation & selection persistence:
  - The currently viewed session is stored per channel and restored on return.
  - If there’s no stored selection: prefer live session if active, else most recent finished session.

## Local storage format (per-channel)

Key naming is scoped by login to keep channels isolated.

- Channel selection (in settings):
  - twitch_mon_settings_v1 (JSON) — includes `selected_channel`.

- Charts (per channel):
  - tm_charts_sessions_<login> (JSON array):
    - Each: { id: string (ISO), start: epoch_ms, end?: epoch_ms | null, last?: epoch_ms, count: number }
      - id: Twitch `stream.started_at` ISO.
      - start: epoch ms for `started_at`.
      - last: last persisted sample timestamp (epoch ms) while live.
      - end: set when channel goes offline (finalized).
      - count: number of samples stored for this session.
  - tm_charts_points_<login>_<sessionId> (JSON array):
    - Points: { x: epoch_ms, y: number | null, gap?: true }
      - y is null for offline gap separation points.
  - tm_charts_selected_session_<login> (string | 'offline' | null):
    - The user's currently selected session chip.

- Chart settings:
  - tm_charts_last_login: last used channel login.
  - tm_charts_interval_ms: poll interval.
  - tm_charts_interval_mode: whether Auto mode is on.
  - tm_charts_show_offline: whether to visually connect nulls.
  - tm_charts_should_resume: whether polling should auto-resume when reopening /charts.

### Migration from legacy points

- If legacy `tm_charts_points_<login>` exists and no sessions are present, the app migrates those points into a single historical session (id = first sample time ISO), then removes the legacy key.

## Chatters storage model

- Presence (continuous, per broadcaster login):
  - `tm_chatters_presence_<login>` (JSON object)
    - Shape: `{ users: { <login>: { name: string, intervals: [{ start: epoch_ms, end: epoch_ms | null }] } } }`
    - Intervals persist across online/offline; `end: null` means an interval is currently open.
- Session metadata and selection (shared with charts; used only to pick x-axis window):
  - `tm_charts_sessions_<login>` — session list (includes `id`, `start`, `end`).
  - `tm_charts_selected_session_<login>` — last selected session id or 'offline'.
- Chatters page convenience keys:
  - `tm_chatters_last_login` — last broadcaster login used on Chatters.
  - `tm_chatters_result_<login>` — last fetched chatters list snapshot; used to pre-seed rows and labels.
  - `tm_chatters_flow_<login-lowercase>` — array of flow points `{ t: epoch_ms, in: number, out: number, ins: string[], outs: string[] }` (arrivals/departures and names) with a rolling cap.
  - `tm_chatters_fit_mode_<login-lowercase>` — boolean; when true, x-axis is kept fitted to data.

## Export/Import (Chatters presence + sessions)

- Toolbar buttons on Chatters:
  - Export JSON: downloads the current per-channel presence database with sessions and selection.
  - Import JSON: loads a JSON file into memory and view (replaces current in-memory presence and sessions for that channel).
- Export schema (example):

```json
{
  "channel": "some_channel",
  "exportedAt": 1730390400000,
  "sessions": [
    { "id": "2025-10-30T01:23:45Z", "start": 1730251425000, "end": 1730258625000, "count": 0 }
  ],
  "selectedSessionId": "2025-10-30T01:23:45Z",
  "users": {
    "alice": {
      "name": "Alice",
      "intervals": [
        { "start": 1730331660000, "end": 1730332260000 },
        { "start": 1730332860000, "end": null }
      ]
    }
  }
}
```

Notes:
- Timestamps are epoch ms (UTC). `end: null` means currently open.
- Import replaces in-memory presence and session state for the channel and fits the view to data.

## Clearing chatter and sessions (per channel)

- Toolbar button: Clear chatter + sessions.
- Removes only chatter-related data for the current channel from localStorage and memory:
  - Presence (continuous and per-session), flow points, sessions list, selected session, last chatter result snapshot.
- Leaves other settings intact (auth, selected channel, timezone, pins, fit mode, window).

## Multi-tab storage behavior

- Storage is client-side per browser. With multiple tabs for the same channel:
  - Writes are effectively last-writer-wins per key.
  - Presence writes are merged from in-memory state each poll, reducing clobbering but not transactional.
  - Flow points may occasionally drop/duplicate across tabs if both append concurrently.
- Options to harden (not enabled by default):
  - Leader election so only one tab polls/writes; others subscribe via BroadcastChannel or storage events.
  - Merge on `storage` events before writing.

## Quickstart for analysis

Load an exported presence JSON and do simple aggregations.

### Node.js

```js
// npm init -y && node analyze.js
const fs = require('fs');

function load(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const data = load('tm_presence_channel_2025-10-31T14-00-00Z.json');
const now = Date.now();

// Total time per user (ms)
const totals = Object.fromEntries(
  Object.entries(data.users).map(([login, u]) => {
    const sum = (u.intervals || []).reduce((acc, it) => acc + ((it.end ?? now) - it.start), 0);
    return [login, sum];
  })
);

// Top 10 by total time
const top = Object.entries(totals)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log('Top 10 by total time (ms):');
for (const [login, ms] of top) console.log(login, ms);
```

### Python

```python
# python analyze.py
import json, time

with open('tm_presence_channel_2025-10-31T14-00-00Z.json', 'r') as f:
    data = json.load(f)

now_ms = int(time.time() * 1000)

# Total time per user (ms)
totals = {
    login: sum(((it.get('end') or now_ms) - it['start']) for it in u.get('intervals', []))
    for login, u in data['users'].items()
}

top = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:10]
print('Top 10 by total time (ms):')
for login, ms in top:
    print(login, ms)
```

## Twitch API usage

The app uses the Helix API via `Authorization: Bearer <token>` and `Client-Id: <client>` headers.

- Get Streams by login:
  - Endpoint: GET https://api.twitch.tv/helix/streams?user_login=<login>
  - Docs: https://dev.twitch.tv/docs/api/reference#get-streams
  - Used for: detecting online/offline; retrieving `started_at`, `viewer_count`, `game_id`, and `title`.
- Get Games by ID:
  - Endpoint: GET https://api.twitch.tv/helix/games?id=<game_id>
  - Docs: https://dev.twitch.tv/docs/api/reference#get-games
  - Used for: resolving game name for status display.
- Chatters:
  - Endpoint: GET https://api.twitch.tv/helix/chat/chatters?broadcaster_id=<id>&moderator_id=<id>
  - Docs: https://dev.twitch.tv/docs/api/reference#get-chatters
  - Scope: moderator:read:chatters
  - Used on the Chatters page.

Notes:
- All calls are client-side using fetch; responses are handled with no-store caching semantics where appropriate.

## Timezone handling

- All samples are stored using epoch ms (UTC).
- Display uses Intl.DateTimeFormat with the selected timezone (`system` -> the browser’s local timezone, or an explicit IANA tz name).
- The Timezone UI is compact by default and can be expanded to quickly change selection; suggestions include system, UTC, recents, aliases, and search.

## Auto-resume, peeks, and navigation behavior

- Auto-resume:
  - When you click Start, the app sets a flag so that returning to /charts automatically starts polling.
  - Clicking Stop clears the flag.
- Peek fetches:
  - On mount/focus and when changing channels while not running, the app performs a non-persisting fetch to detect online/offline and live session id (if any). This selects the right chip and status immediately without storing samples.
- Polling restarts on interval/running/login changes and an immediate poll executes so UI reflects the latest state without waiting for the interval.

## Developing locally & deploying to GitHub Pages

- Local dev:
  - npm install && npm run dev
  - Visit http://localhost:3000
  - OAuth redirect URI is http://localhost:3000/callback/
- GitHub Pages:
  - Build with a proper NEXT_PUBLIC_BASE_PATH (e.g., /<repo>) and host under https://<user>.github.io/<repo>/.
  - Redirect URI becomes https://<user>.github.io/<repo>/callback/.
- Note that the various tools report different paths for the app.  /media/david/bigwork/twitch-mon/web/ and /home/david/bigwork/twitch-mon/web/ are both valid.

## Troubleshooting

- Blank chart after navigation:
  - The app forces an immediate resize after init and update; if it still appears blank, ensure the chart container has non-zero dimensions and check console for network errors.
- No LIVE chip while streaming:
  - Ensure polling (Start) is running and Twitch reports `started_at`.
- Session not remembered on return:
  - Verify localStorage has `tm_charts_selected_session_<login>`; selecting a chip updates it and it will be restored on re-entry.


## Note

- Main chart: total in room should re-range for the current window, not all time
- duration in room chart should have consistent y axis label
- all chart titles should be consistent and bolder

