import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { listPokemons, listTypeEffectiveness } from '../db/pokemons.js';

// Mounted at /api in app.js → GET /api/pokemons, GET /api/type-effectiveness.
export const catalogRouter = Router();

catalogRouter.get(
  '/pokemons',
  asyncHandler(async (req, res) => {
    res.status(200).json(await listPokemons());
  }),
);

catalogRouter.get(
  '/type-effectiveness',
  asyncHandler(async (req, res) => {
    res.status(200).json(await listTypeEffectiveness());
  }),
);