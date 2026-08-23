import { createServer } from 'node:http';
import { createApp } from './app.js';

const port = process.env.PORT ?? 3000;

// Shared http.Server so the Socket.IO layer (createSocketServer, PR 2) can
// attach to the same listener as the Express app.
const httpServer = createServer(createApp());

httpServer.listen(port, () => {
  console.log(`pokeduels API listening on port ${port}`);
});