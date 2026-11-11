/**
 * Starting point of the backend: updates the database, then starts the server.
 */
import { createApp } from "./app.js";
import { migrate } from "./db.js";
import { loadSettings } from "./services/settings.js";

const port = Number(process.env.PORT ?? 3000);
await migrate();
await loadSettings();
createApp().listen(port, () => console.log(`API on http://localhost:${port}`));
