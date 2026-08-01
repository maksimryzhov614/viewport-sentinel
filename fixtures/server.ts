import { startFixtureServer } from '../src/fixtures/server.js';

const server = await startFixtureServer(4173);
console.log(`Fixture server: ${server.url}`);
