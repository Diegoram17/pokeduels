import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './ws/index.js';

const port = process.env.PORT ?? 3000;

// Shared http.Server so the Socket.IO layer (createSocketServer) attaches to
// the same listener as the Express app.
const httpServer = createServer(createApp());
createSocketServer(httpServer);

httpServer.listen(port, () => {
  console.log(`pokeduels API listening on port ${port}`);
});