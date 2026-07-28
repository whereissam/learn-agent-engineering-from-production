# Operations

## Deploy

```bash
bun run src/server.ts
```

The service is stateless apart from the in-memory link map, so a restart
loses every link created since boot. This is acceptable today because the
service is still in beta; it is the main reason the Postgres migration
(`src/db/migrations.ts`) is on the roadmap.

## Health checks

`GET /health` returns `{ "ok": true, "links": N }`. The load balancer treats
any non-200 as unhealthy and pulls the instance out of rotation after three
consecutive failures.

Note that `links` counts entries in memory, not rows in a database. After a
restart it legitimately reads 0.

## Alerts

| Alert | Condition | First thing to check |
|---|---|---|
| `HighRedirectMisses` | 404 rate on `GET /:code` above 5% for 10 minutes | Whether links created in the last hour resolve. This alert has been firing intermittently since the analytics release |
| `RateLimitSaturation` | More than 1% of requests get 429 | One client hammering `/shorten`; check `x-forwarded-for` in the logs |
| `SweeperStalled` | `swept clicks` log line absent for 15 minutes | The interval timer is `unref`'d, so it does not keep the process alive; if the event loop is blocked it silently stops |

## Known operational quirks

- **Rate limiting is per process.** With more than one instance behind the
  load balancer the effective limit is `RATE_LIMIT × instances`.
- **Click records are memory-resident.** At current traffic the sweeper keeps
  the array small, but a traffic spike plus a stalled sweeper will grow it
  without bound.
- **The 404 alert and the "stats show zero" reports arrived in the same week.**
  Nobody has checked whether they are related.

## Rolling back

There is no database, so a rollback is just deploying the previous image.
Links created by the newer version are lost, which so far nobody has
complained about.
