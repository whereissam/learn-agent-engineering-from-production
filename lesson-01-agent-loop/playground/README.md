# Tiny URL Shortener

A small HTTP service that turns long URLs into short codes.

## Files

- `src/server.ts` - the HTTP handlers
- `src/store.ts` - in-memory storage and code generation
- `src/config.ts` - configuration constants

## Endpoints

- `POST /shorten` with `{ "url": "https://..." }` → `{ "code": "a1b2c3" }`
- `GET /:code` → 302 redirect to the original URL

## Known issue

Users occasionally report that a freshly created short link returns 404.
Nobody has figured out why yet.
