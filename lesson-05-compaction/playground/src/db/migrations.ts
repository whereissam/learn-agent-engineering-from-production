/**
 * Schema migrations.
 *
 * The service currently keeps links in memory, but the migration list is
 * already here because moving to Postgres is planned and we want the history
 * to exist from day one rather than being reconstructed later.
 *
 * Rules:
 *   - migrations are append-only; never edit one that has shipped
 *   - every migration must be safe to run twice
 */

export interface Migration {
	id: number;
	name: string;
	up: string;
}

export const MIGRATIONS: Migration[] = [
	{
		id: 1,
		name: "create_links",
		up: `CREATE TABLE IF NOT EXISTS links (
			code       TEXT PRIMARY KEY,
			url        TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
	},
	{
		id: 2,
		name: "create_clicks",
		up: `CREATE TABLE IF NOT EXISTS clicks (
			id         BIGSERIAL PRIMARY KEY,
			code       TEXT NOT NULL REFERENCES links(code),
			at         TIMESTAMPTZ NOT NULL DEFAULT now(),
			referer    TEXT,
			user_agent TEXT
		)`,
	},
	{
		id: 3,
		name: "index_clicks_by_code",
		up: "CREATE INDEX IF NOT EXISTS clicks_code_at ON clicks (code, at DESC)",
	},
	{
		id: 4,
		name: "links_created_at_index",
		up: "CREATE INDEX IF NOT EXISTS links_created_at ON links (created_at DESC)",
	},
];

export function pending(appliedIds: number[]): Migration[] {
	const applied = new Set(appliedIds);
	return MIGRATIONS.filter((migration) => !applied.has(migration.id));
}
