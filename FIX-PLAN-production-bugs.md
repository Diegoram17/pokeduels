# Fix Plan — Production Bugs (Render)

Audience: the implementing agent. Execute every step in order.

Root-cause analysis was done via CodeGraph + direct source reads against the
current `master` (commit `78bfb3d`). File:line references below are accurate
as of that commit — re-check line numbers before editing if the tree has
moved since.

---

## Bug 1 — Ghost "waiting" rooms pile up in the lobby

**Symptom:** logging in shows many rooms in the lobby even though no one is
playing.

**Confirmed root cause:**

1. `backend/ws/reconnectTimers.js:1-11` — the reconnect-grace timer registry
   is an in-memory `Map`. Its own docstring: *"a backend restart loses
   in-flight grace windows (accepted, documented)."*
2. `backend/ws/roomHandlers.js` (`disconnect` handler, lobby/waiting branch,
   ~L190-195) — on disconnect it marks the player `connected=FALSE` then arms
   a 60s in-memory timer that eventually calls `handleLeaveOrClose`, which
   deletes the room if it becomes empty. If the Node process restarts before
   that timer fires — a Render deploy, or a free-tier spin-down/spin-up — the
   timer is lost forever and the row is never cleaned up.
3. `backend/db/reconciliation.js` (`reconcileOrphanedDuels`, boot-time
   ADR-0008 sweep) only reconciles `duels.status='in_progress'` and the rooms
   linked to them. It never touches `rooms.status='waiting'`.
4. `backend/db/rooms.js` (`listWaitingRooms`, ~L57-74) lists every
   `status='waiting'` room unconditionally. Its own comment — *"Empty rooms
   are deleted automatically when the last player leaves, so no stale
   cleanup filter is needed here"* — is the false assumption: it assumes the
   in-memory timer cleanup always runs, which a process restart breaks.

Net effect: every `waiting` room that was abandoned across a deploy or a
free-tier spin-down stays in the DB forever, and `GET /api/rooms` shows it
to every future visitor.

**Fix — add a boot-time sweep for stale `waiting` rooms, symmetric to the
existing orphaned-duel sweep:**

A `waiting` room can only exist while players are coordinating live over a
WebSocket to *this* process. A process boot means no live connection from
before survived it, so **every** room still `status='waiting'` at boot time
predates this process instance and is abandoned by definition — this must be
unconditional, not just "all players disconnected": a hard process crash
(e.g. a mid-connection redeploy) never gets to run `markPlayerDisconnected`,
so some ghosts will show `connected=TRUE` forever too.

1. In `backend/db/reconciliation.js`, add a new exported function next to
   `reconcileOrphanedDuels`:

   ```js
   /**
    * Boot-time reconciliation (ADR-0008 extension): a `waiting` room can only
    * exist while players hold a live WS connection to THIS process. A boot
    * means no connection from before survived it, so every room still
    * `status='waiting'` at boot time is abandoned — the in-memory reconnect
    * grace timer that would normally clean it up (reconnectTimers.js) does
    * not survive a process restart. Deletion cascades to room_players and
    * team_selections via existing FKs. Errors propagate (fail closed), same
    * contract as reconcileOrphanedDuels.
    */
   export async function reconcileStaleWaitingRooms() {
     const client = await pool.connect();
     try {
       await client.query('BEGIN');
       const { rows: stale } = await client.query(
         "SELECT id FROM rooms WHERE status = 'waiting'",
       );
       if (stale.length > 0) {
         await client.query(
           "DELETE FROM rooms WHERE id = ANY($1::int[])",
           [stale.map((r) => r.id)],
         );
       }
       await client.query('COMMIT');
       return { roomIds: stale.map((r) => r.id) };
     } catch (err) {
       await client.query('ROLLBACK').catch(() => {});
       throw err;
     } finally {
       client.release();
     }
   }
   ```

2. In `backend/server.js`, call it right next to the existing call, before
   `.listen()`:

   ```js
   import { reconcileOrphanedDuels, reconcileStaleWaitingRooms } from './db/reconciliation.js';
   ...
   await reconcileOrphanedDuels();
   await reconcileStaleWaitingRooms();
   ```

   Keep it a *second* awaited call, not merged into the first function — they
   sweep different lifecycle stages and existing tests target
   `reconcileOrphanedDuels` in isolation.

3. Extend `backend/test/reconciliation.test.js` with cases for the new
   function:
   - a `waiting` room with a `connected=TRUE` player is deleted at boot;
   - a `waiting` room with only `connected=FALSE` players is deleted;
   - `in_progress`, `finished`, and `aborted` rooms are left untouched by
     this sweep;
   - `room_players` and `team_selections` rows for the deleted room are gone
     too (cascade), with no orphaned rows in either table;
   - a genuinely empty DB (no rooms at all) does not error.

4. Run the full backend suite (`npm test` in `backend/`) and confirm nothing
   that depends on a `waiting` room surviving a reconciliation call breaks
   (search the test suite for any test that creates a `waiting` room and then
   calls `reconcileOrphanedDuels`/boots the app inside the same test — none
   should exist today, but confirm).

5. **Deploy and manually verify against the production DB**: after deploy,
   confirm the existing ghost rows are gone (`SELECT count(*) FROM rooms
   WHERE status='waiting';` should be 0 right after boot, before any new
   room is created) and that the lobby is empty on first load.

---

## Bug 2 — "I appear in a room with other players" (CONFIRMED, screenshot evidence)

**Update:** the user provided a screenshot of `/wait-room` showing `2 / 2`
with `Diego` (ready) and a second seat `VORTEX_99`. `VORTEX_99` does **not**
carry the `🤖 ` prefix every bot gets (`backend/ws/botManager.js:47`,
`'🤖 ' + BOT_NAMES[...]`), so it is not a bot — it is a real leftover
`room_players` row. This also matches the user's separate complaint that
nothing on that screen lets them start: both symptoms share one root cause,
found by re-reading the full reconnect path.

**Confirmed root cause — stale room state is restored from localStorage and
never re-synced with the live server:**

1. `loadMockState` (`frontend/src/state/store.ts:65-83`) only wipes
   `state.room` when the player identity is missing or changed. If the same
   browser/session persists (same `playerId`/`sessionToken` — the normal
   case, since nothing ever clears them), whatever `state.room` was last
   saved — full roster, `ready` flags, all of it — is restored **verbatim**
   on the next load, before any contact with the server. `saveMockState`
   (`MockStateProvider.tsx:82-84`) persists on every state change, so this
   snapshot can be an old, fully-live room from a previous session — e.g.
   one that once had a real second player (`VORTEX_99`) in it.
2. `MockStateProvider`'s WS-connect `useEffect` (`MockStateProvider.tsx:91-237`)
   connects the socket and wires up every listener, but **never re-emits
   `room:join` for a restored `state.room.code`**. Compare this to the
   duel-side of the exact same effect, which already does this correctly for
   duels (`pendingJoinRef`, flushed right after `socketRef.current = socket`)
   — the room side of the reconnect path was simply never built.
3. Because `room:join` is never re-sent, the server never learns this socket
   belongs to that room: `socket.data.roomId` stays `undefined`
   (`backend/ws/roomHandlers.js` — only ever set inside the `room:join`
   handler, ~L83). So the screen the user sees is a **frozen, disconnected
   snapshot**: it will never receive a fresh `room:state` broadcast (the
   socket was never added to the `room:{roomId}` Socket.IO channel), and
   clicking `LISTO` emits `room:ready`, whose handler reads
   `socket.data.roomId` (`undefined`), calls `setPlayerReady(undefined, ...)`
   (matches no row, silently no-ops), and then
   `broadcastRoomState(io, undefined)` → `getRoomState(undefined)` returns
   `undefined` → nothing is broadcast. That is exactly "no hay nada para
   que inicie": every action on that screen is silently swallowed because
   the client was never actually re-admitted to the room this session.

**Fix — re-join the persisted room on every (re)connect, and handle a room
that no longer exists:**

1. **`frontend/src/state/MockStateProvider.tsx`** — in the WS-connect
   `useEffect`, right after `socketRef.current = socket` and the existing
   `pendingJoinRef` flush (~L100-110), add:

   ```tsx
   // Re-sync a persisted room membership on every (re)connect — mirrors the
   // pendingJoinRef pattern above, but for rooms: loadMockState() can restore
   // a room from a previous session, and without this the client never tells
   // the server it's back, so it never receives a fresh room:state and every
   // room:ready/leave silently no-ops (socket.data.roomId stays undefined).
   const persistedRoomCode = stateRef.current.room?.code
   if (persistedRoomCode) {
     socket.emit('room:join', {
       code: persistedRoomCode,
       nickname: stateRef.current.player.nickname,
     })
   }
   ```

   Then add a listener (alongside the other `socket.on(...)` calls) for the
   new rejection event added below:

   ```tsx
   // room:join_rejected — the persisted room no longer exists server-side
   // (finished/aborted/deleted). Drop it locally instead of leaving the user
   // stuck on a dead wait-room screen forever.
   socket.on('room:join_rejected', () => {
     send({ type: 'roomJoinRejected' })
   })
   ```

   And unsubscribe it in the effect's cleanup, next to the other `socket.off`
   calls: `socket.off('room:join_rejected')`.

2. **`frontend/src/state/store.ts`** — add the new action type to the
   `MockStateAction` union (next to `roomAbortedAcknowledged`):

   ```ts
   | { type: 'roomJoinRejected' }
   ```

   and a reducer case (next to the `roomAborted`/`roomAbortedAcknowledged`
   cases), resetting exactly the same room-scoped slice `roomShellReceived`
   resets, minus setting a room:

   ```ts
   case 'roomJoinRejected':
     return {
       ...state,
       room: null,
       tournament: null,
       duel: null,
       pendingDuelId: null,
     }
   ```

   `WaitRoomScreen` already does `if (!room) return <Navigate to="/lobby" replace />`,
   so clearing `state.room` alone sends the user back to the lobby — no
   routing change needed.

3. **`backend/ws/roomHandlers.js`** — the `room:join` handler currently lets
   `joinOrResumeRoom`'s `HttpError` (404 unknown code, 409 full/not-waiting)
   propagate straight out of the handler. `withWsHandler` only turns a
   `WsError` into a client-visible event (`backend/ws/wsFaultIsolation.js:17-28`);
   anything else — including this `HttpError` — is logged server-side and
   swallowed, so the client that just tried an automatic rejoin gets **no
   event at all** and stays stuck showing the stale room forever. Catch it
   and translate it into the rejection the frontend now listens for:

   ```js
   import { HttpError } from '../lib/httpError.js';
   import { WsError } from '../lib/wsError.js';
   ```

   ```js
   socket.on('room:join', (payload) =>
     withWsHandler(socket, async () => {
       const { code } = payload ?? {};
       const playerId = socket.data.player.id;
       const nickname =
         typeof payload?.nickname === 'string' &&
         payload.nickname.trim().length > 0 &&
         payload.nickname.length <= MAX_NICKNAME_LENGTH
           ? payload.nickname
           : socket.data.player.nickname;

       let room;
       try {
         room = await joinOrResumeRoom(code, playerId, nickname);
       } catch (err) {
         if (err instanceof HttpError) {
           throw new WsError('room:join_rejected', { code, reason: err.statusCode === 404 ? 'not_found' : 'unavailable' });
         }
         throw err;
       }

       socket.data.roomId = room.id;
       socket.join(`room:${room.id}`);
       reconnectTimers.cancel(room.id, playerId);
       bracketWalkoverTimers.cancel(room.id, playerId);
       await markPlayerConnected(room.id, playerId);

       if (room.status === 'aborted') {
         io.to(`room:${room.id}`).emit('room:aborted', {
           roomId: room.id,
           reason: 'server_restart',
         });
       } else {
         await broadcastRoomState(io, room.id);
       }
     }),
   );
   ```

   (Only the `try/catch` around `joinOrResumeRoom` and the two new imports
   are new — the rest of the handler body is unchanged, shown in full so the
   replacement is unambiguous.)

**Why this also fixes what looked like a second bug:** once the client
re-joins on connect, a genuinely fresh room (just created this session) gets
its own fresh `room:state` immediately, and a stale/dead room gets cleared
and bounced to the lobby — either way, the frozen "phantom `VORTEX_99`"
snapshot can no longer linger on screen, and `LISTO`/`INICIAR PARTIDA`
(Bug 3) work again because `socket.data.roomId` is finally set.

**Tests to add:**

- `backend/test/roomHandlers.test.js`: `room:join` with an unknown code emits
  `room:join_rejected` with `reason: 'not_found'` instead of throwing/silently
  swallowing.
- `frontend/src/state/__tests__/store.test.ts` (or wherever reducer tests
  live): `roomJoinRejected` clears `room`/`tournament`/`duel`/`pendingDuelId`
  and leaves `player` untouched.
- A `MockStateProvider`/`WaitRoomScreen.ws.test.tsx` case: mounting with a
  persisted `state.room` causes an immediate `room:join` emit on connect.

---

## Bug 3 — No explicit way to start the match; bot button doesn't match spec

**Current state (confirmed):**

- `WaitRoomScreen.tsx` has a `LISTO`/ready toggle (~L382-399) that emits
  `room:ready`. The server (`backend/ws/roomHandlers.js`, `room:ready`
  handler) calls `bootstrapDuelIfReady`/`bootstrapBracketIfReady`
  (`backend/ws/duelBootstrap.js`), which auto-starts the duel/bracket the
  moment the room is **full** (`players.length === maxPlayers`) **and**
  every seat is ready. There is no explicit "start" action anywhere — match
  start is implicit and easy to miss, which is why it "no figura en ningún
  lugar."
- `BotManager` (`WaitRoomScreen.tsx` ~L218-267) has one "AGREGAR BOT" button
  that adds exactly one bot per click, for both 1v1 and tournament rooms.
  For a 4-player tournament room this requires the host to click it up to 3
  times — it doesn't fulfill "un bot... o bots" (plural / fill-all for
  tournaments) as originally requested.
- Bots auto-ready themselves: `backend/ws/botManager.js`
  (`autoSelectBotTeam`, ~L136-175) sets `ready=TRUE` right after picking a
  team, so a bot never blocks the full-ready gate.

**Fix A — bot button matches "one bot for 1v1, fill-all for tournament":**

Replace the whole `BotManager` function in `WaitRoomScreen.tsx` (~L218-267)
with:

```tsx
function BotManager({
  room,
  onBotAdded,
}: {
  room: RoomState
  onBotAdded: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentPlayers = room.players.length
  const emptySlots = room.maxPlayers - currentPlayers
  const hasEmptySlots = emptySlots > 0

  async function handleAddBots() {
    if (!hasEmptySlots) return
    setAdding(true)
    setError(null)
    try {
      // Sequential on purpose, NOT Promise.all: autoSelectBotTeam reads the
      // "available starters" list before writing its pick, so concurrent bot
      // creations could read the same list and collide on
      // uq_starter_por_sala (unique starter per room).
      for (let i = 0; i < emptySlots; i += 1) {
        await createBot(room.code)
      }
    } catch (err) {
      setError(describeApiError(err))
    } finally {
      // Refresh even on partial failure — some bots may have been added
      // before the request that failed.
      onBotAdded()
      setAdding(false)
    }
  }

  if (!hasEmptySlots) return null

  // maxPlayers === 2 (1v1): emptySlots is always exactly 1 here -> "AGREGAR BOT".
  // maxPlayers === 4 (torneo): 1 empty slot -> "AGREGAR BOT"; 2 or 3 -> "AGREGAR BOTS"
  // and one click fills every remaining seat.
  const label = emptySlots > 1 ? 'AGREGAR BOTS' : 'AGREGAR BOT'
  const loadingLabel = emptySlots > 1 ? 'AGREGANDO BOTS...' : 'AGREGANDO...'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pd-space-2)' }}>
      <button
        type="button"
        className="pd-btn pd-btn--secondary pd-btn--block"
        onClick={handleAddBots}
        disabled={adding}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--pd-space-2)' }}
      >
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 20 }}>
          smart_toy
        </span>
        {adding ? loadingLabel : label}
      </button>
      {error && (
        <p role="alert" className="pd-meta" style={{ color: 'var(--pd-danger)', margin: 0, textAlign: 'center' }}>
          {error}
        </p>
      )}
    </div>
  )
}
```

No other file needs to change for this fix — `BotManager` already receives
`room` as a prop and is the only place `createBot` is called from the UI.
This is exactly the "un bot si estoy en 1v1, o bots si estoy en un torneo"
button the user originally asked for: in a 1v1 room `emptySlots` can only
ever be 1, so it always reads "AGREGAR BOT" and adds the single missing
player; in a 4-player tournament room it reads "AGREGAR BOTS" whenever more
than one seat is empty and fills all of them in one click.

**Fix B — explicit "start match" action:**

Add a new button in `WaitRoomScreen.tsx`'s action stack (same block as
`LISTO` / `LeaveRoomButton` / `CAMBIAR EQUIPO`, ~L380-408), rendered only
when the room is genuinely full and the current player hasn't readied yet:

```tsx
function StartMatchButton({
  isFull,
  isReady,
  onStart,
}: {
  isFull: boolean
  isReady: boolean
  onStart: () => void
}) {
  if (!isFull || isReady) return null
  return (
    <button
      type="button"
      className="pd-btn pd-btn--primary pd-btn--block"
      onClick={onStart}
    >
      <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>
      INICIAR PARTIDA
    </button>
  )
}
```

Wire it in `WaitRoomScreen` right above the existing `LISTO` button:
`isFull = players.length === room.maxPlayers`, `onStart={() =>
actions.setReady(true)}`. This reuses the exact same `room:ready` → WS →
`bootstrapDuelIfReady`/`bootstrapBracketIfReady` pipeline that already
works — **no backend changes needed for this part**. It gives a clear,
labeled call-to-action at the moment the match can actually begin, instead
of relying on the player noticing that toggling `LISTO` silently starts
the game once everyone else is ready too. Keep the existing `LISTO` toggle
as-is (still needed for real multiplayer, where players ready up before the
room is full).

**Tests to add:**

- `frontend/src/routes/__tests__/WaitRoomScreen.test.tsx` /
  `WaitRoomScreen.ws.test.tsx`: `StartMatchButton` is absent when the room
  isn't full, present when it is full and the player isn't ready yet, and
  clicking it emits `room:ready` with `ready: true`.
- A `BotManager` test covering the tournament "fill all empty slots"
  behavior: clicking once with 3 empty slots issues 3 sequential
  `createBot` calls before re-rendering.

---

## Verification checklist (for the executing agent, before reporting done)

- [ ] `npm test` passes in `backend/` (existing suite + new reconciliation
      tests).
- [ ] `npm test` passes in `frontend/` (existing suite + new
      WaitRoomScreen/BotManager tests).
- [ ] Manually run the app locally: fresh login → lobby is empty → create a
      1v1 room → team-select → wait-room shows only yourself → add one bot
      → `INICIAR PARTIDA` appears once the room is full → clicking it enters
      the duel.
- [ ] Manually run a 4-player tournament room: create → `AGREGAR BOTS` fills
      all 3 remaining seats in one click → `INICIAR PARTIDA` appears → click
      → bracket bootstraps.
- [ ] Deploy to Render.
- [ ] Confirm in production: fresh incognito login shows an empty lobby.
- [ ] Confirm in production: creating a room and inspecting the `room:state`
      WS payload shows only the creator.
- [ ] Confirm in production: reload the page while sitting in `/wait-room`
      (or close and reopen the tab) — the client re-emits `room:join` and
      either restores the same live room correctly, or (if it's since ended)
      gets bounced to `/lobby` instead of showing a frozen stale roster.

Do not report this plan as complete without having actually run the app (or
its test suite) and observed the behaviors above — a claim of "fixed" without
that evidence is what triggered this plan in the first place.
