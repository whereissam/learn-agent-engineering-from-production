# Tiny URL Shortener

A small HTTP service that turns long URLs into short codes, with click
analytics and rate limiting.

## Layout

```
src/config.ts          constants: alphabet, limits, blocked hosts
src/store.ts           in-memory link storage and code generation
src/analytics.ts       click records, per-code stats, sweeper
src/validate.ts        URL and code validation
src/rate-limit.ts      fixed-window rate limiting
src/logger.ts          structured logging
src/server.ts          HTTP router
src/routes/            one file per endpoint
src/db/migrations.ts   schema history (for the planned Postgres move)
docs/API.md            endpoint reference
test/store.test.ts     unit tests
```

## Running

```bash
bun run src/server.ts
bun test
```

## Known issues

Two tests are failing, and support has two open reports that may or may not be
the same bug:

1. **"A link I just created returns 404."** Not always. Roughly one in three
   new links, with no obvious pattern in which ones.

2. **"The stats page says 0 clicks for a link people are definitely using."**
   The redirect works for those links, but `/stats/:code` stays at zero.

Nobody has connected the two yet.
