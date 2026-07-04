import { Hono } from 'hono';
import { html } from 'hono/html'

const app = new Hono();

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

app.get('/library/:name', c => {
  const name = c.req.param('name');
  return c.html(
    html`<p>You're looking at the page for the ${name} library.</p>`
  );
});

export default app;
