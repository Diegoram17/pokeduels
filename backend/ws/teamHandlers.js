import { WsError } from '../lib/wsError.js';
import { selectStarter, selectRoster } from '../db/teamSelections.js';
import { broadcastRoomState } from './roomState.js';
import { withWsHandler } from './wsFaultIsolation.js';

/**
 * Registers team-selection event handlers for one connected socket, each
 * wrapped in withWsHandler: WsErrors (validation + DB-level rejections) are
 * emitted to the client as team:*_rejected events; genuine faults are logged
 * and swallowed so one bad request never crashes the shared process.
 *
 * Starter payload validation (positive integer pokemonId) lives here; roster
 * count=5 / no-duplicate validation lives in selectRoster (single source of
 * truth, mapped to team:roster_rejected per the design's error table).
 */
export function registerTeamHandlers(io, socket) {
  socket.on('team:select_starter', (payload) =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.player.id;
      const pokemonId = payload?.pokemonId;

      if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
        throw new WsError('team:starter_rejected', { pokemonId, reason: 'invalid' });
      }

      await selectStarter(roomId, playerId, pokemonId);
      await broadcastRoomState(io, roomId);
    }),
  );

  socket.on('team:select_roster', (payload) =>
    withWsHandler(socket, async () => {
      const roomId = socket.data.roomId;
      const playerId = socket.data.player.id;

      await selectRoster(roomId, playerId, payload?.pokemonIds);
      await broadcastRoomState(io, roomId);
    }),
  );
}