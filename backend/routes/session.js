import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../lib/httpError.js';
import { createPlayer } from '../db/players.js';

const MAX_NICKNAME_LENGTH = 30;

export const sessionRouter = Router();

sessionRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { nickname } = req.body ?? {};
    if (
      typeof nickname !== 'string' ||
      nickname.trim().length === 0 ||
      nickname.length > MAX_NICKNAME_LENGTH
    ) {
      throw new HttpError(400, 'nickname is required and must be at most 30 characters');
    }

    const player = await createPlayer(nickname);
    res.status(201).json({ playerId: player.id, sessionToken: player.sessionToken });
  }),
);