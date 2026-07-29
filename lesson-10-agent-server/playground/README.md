# Tiny URL Shortener

A small HTTP service that turns long URLs into short codes.

## Files

- `src/server.ts` - the HTTP handlers
- `src/store.ts` - in-memory storage and code generation
- `src/config.ts` - configuration constants
- `test/store.test.ts` - unit tests

## Running the tests

```bash
bun test
```

## Endpoints

- `POST /shorten` with `{ "url": "https://..." }` → `{ "code": "a1b2c3" }`
- `GET /:code` → 302 redirect to the original URL

## Known issue

Two tests are currently failing. Users also report that a freshly created
short link sometimes returns 404. Nobody has figured out why yet.
