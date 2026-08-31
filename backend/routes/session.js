import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../lib/httpError.js';
import { createPlayer } from '../db/players.js';
import { sanitizeNickname } from '../lib/sanitizeNickname.js';

export const sessionRouter = Router();

sessionRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { nickname } = req.body ?? {};
    const result = sanitizeNickname(nickname);
    if (!result.ok) {
      throw new HttpError(400, 'nickname must be 3–30 characters and free of control characters');
    }

    const player = await createPlayer(result.value);
    res.status(201).json({ playerId: player.id, sessionToken: player.sessionToken });
  }),
);