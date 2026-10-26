# tsql: with PostgREST

A todo list where a free plan allows 3 todos. The rule is written once, in `functions/todos.ts`:
the page runs it to grey out its button, and PostgreSQL runs the compiled copy in a trigger, so no
client can get around it. PostgREST serves the tables; a React page, served by Vite, reads them.

```bash
npm install
npm run parity    # prove the SQL gives the same answers as the TypeScript
npm run db        # compile to db/01_functions.sql, start PostgreSQL and PostgREST (Docker)
npm run dev       # the page, on http://localhost:5173
```

The database scripts run once, on an empty database. After changing a function, run
`docker compose down -v` and `npm run db` again.
