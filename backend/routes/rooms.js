import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../lib/httpError.js';
import { requireAuth } from '../middleware/auth.js';
import { createRoomCreateLimiter } from '../middleware/rateLimit.js';
import { createRoomWithCreator, listWaitingRooms, joinRoom, getRoomByCode } from '../db/rooms.js';
import { createBot, removeBot } from '../ws/botManager.js';
import { broadcastRoomState } from '../ws/roomState.js';

const VALID_MAX_PLAYERS = new Set([2, 4]);
const MAX_NICKNAME_LENGTH = 30;

/**
 * Factory returning a FRESH router (and a FRESH room-create limiter) per
 * call, so createApp() gives each app instance isolated rate-limit counters.
 * Mounted at /api/rooms in app.js.
 */
export function createRoomsRouter() {
  const router = Router();

  // GET /api/rooms — public lobby listing, no auth (spec).
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.status(200).json(await listWaitingRooms());
    }),
  );

  // POST /api/rooms — rate-limited (5/min per IP) BEFORE auth so floods are
  // rejected without spending a DB round trip (design decision), then
  // authenticated, then validated.
  router.post(
    '/',
    createRoomCreateLimiter(),
    requireAuth,
    asyncHandler(async (req, res) => {
      const { max_players } = req.body ?? {};
      if (!VALID_MAX_PLAYERS.has(max_players)) {
        throw new HttpError(400, 'max_players must be 2 or 4');
      }
      const room = await createRoomWithCreator(max_players, req.player.id);
      res.status(201).json(room);
    }),
  );

  // POST /api/rooms/:code/join — authenticated join; capacity/status conflicts
  // surface as 409 (HttpError from joinRoom, or pg 23505 through the error
  // middleware), unknown codes as 404.
  router.post(
    '/:code/join',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { nickname } = req.body ?? {};
      if (
        typeof nickname !== 'string' ||
        nickname.trim().length === 0 ||
        nickname.length > MAX_NICKNAME_LENGTH
      ) {
        throw new HttpError(400, 'nickname is required and must be at most 30 characters');
      }
      const room = await joinRoom(req.params.code, req.player.id, nickname);
      res.status(201).json(room);
    }),
  );

  // POST /api/rooms/:code/bots — create a bot in the room (authenticated).
  // Only room members can create bots. The bot auto-selects a random team.
  router.post(
    '/:code/bots',
    requireAuth,
    asyncHandler(async (req, res) => {
      const room = await getRoomByCode(req.params.code);
      if (!room) throw new HttpError(404, 'room not found');
      
      const bot = await createBot(room.id, req.player.id);
      
      // Broadcast updated room state
      await broadcastRoomState(req.app.get('io'), room.id);
      
      res.status(201).json(bot);
    }),
  );

  // DELETE /api/rooms/:code/bots/:botId — remove a bot from the room (authenticated).
  // Only room members can remove bots.
  router.delete(
    '/:code/bots/:botId',
    requireAuth,
    asyncHandler(async (req, res) => {
      const room = await getRoomByCode(req.params.code);
      if (!room) throw new HttpError(404, 'room not found');
      
      const botId = parseInt(req.params.botId, 10);
      if (isNaN(botId)) throw new HttpError(400, 'invalid bot id');
      
      await removeBot(room.id, botId, req.player.id);
      
      // Broadcast updated room state (if room still exists)
      if (!room.deleted) {
        await broadcastRoomState(req.app.get('io'), room.id);
      }
      
      res.status(204).send();
    }),
  );

  return router;
}