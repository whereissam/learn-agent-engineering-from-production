# API

Base URL: `http://localhost:8080`

## POST /shorten

Create a short link.

```json
{ "url": "https://example.com/a/very/long/path" }
```

Responses:

| Status | Body | When |
|---|---|---|
| 201 | `{ "code": "aB3xY9" }` | created |
| 400 | `{ "error": "...", "field": "url" }` | validation failed |
| 429 | `{ "error": "rate limit exceeded" }` | too many requests from this IP |

Validation rules live in `src/validate.ts`:

- must be an absolute URL
- scheme must be `http:` or `https:`
- at most 2048 characters
- host must not be in `BLOCKED_HOSTS`

## GET /:code

Redirect to the original URL. Returns `302` with a `Location` header, or
`404` if the code is unknown.

Every successful redirect is recorded by `src/analytics.ts`.

## GET /stats/:code

```json
{ "code": "aB3xY9", "clicks": 12, "lastAt": 1793000000000 }
```

Returns `404` if the code does not exist.

## GET /stats

Service-wide summary: total links, total clicks, and the five most followed
codes.

## GET /health

```json
{ "ok": true, "links": 128 }
```

## Notes on short codes

Codes are six characters from `[A-Za-z0-9]`. They are **advertised as
case-insensitive**: a user who types `AB3XY9` should land on the same page as
`aB3xY9`, because codes get copied out of print, email and chat where case is
routinely mangled.
