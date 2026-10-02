import { Hono } from 'hono';
import type { Env } from './env';
import auth from './http/auth';
import account from './http/account';
import rooms from './http/rooms';

/** HTTP routes share the runtime services injected by the Node entry point. */
const app = new Hono<{ Bindings: Env }>();
app.route('/', auth);
app.route('/', account);
app.route('/', rooms);
export default app;
