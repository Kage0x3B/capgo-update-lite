import { sql } from 'drizzle-orm';
import {
	bigserial,
	boolean,
	index,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';

export const apps = pgTable('apps', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const bundles = pgTable(
	'bundles',
	{
		id: serial('id').primaryKey(),
		appId: text('app_id')
			.notNull()
			.references(() => apps.id),
		channel: text('channel').notNull().default('production'),
		version: text('version').notNull(),
		platforms: text('platforms')
			.array()
			.notNull()
			.default(sql`ARRAY['ios','android']::text[]`),
		r2Key: text('r2_key').notNull(),
		checksum: text('checksum').notNull().default(''),
		sessionKey: text('session_key').notNull().default(''),
		link: text('link'),
		comment: text('comment'),
		active: boolean('active').notNull().default(false),
		state: text('state').notNull().default('pending'),
		releasedAt: timestamp('released_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('bundles_app_channel_version_uq').on(t.appId, t.channel, t.version),
		index('bundles_resolver_idx').on(t.appId, t.channel, t.active, t.releasedAt)
	]
);

export const statsEvents = pgTable(
	'stats_events',
	{
		id: bigserial('id', { mode: 'bigint' }).primaryKey(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
		appId: text('app_id').notNull(),
		deviceId: text('device_id').notNull(),
		action: text('action'),
		versionName: text('version_name'),
		oldVersionName: text('old_version_name'),
		platform: text('platform'),
		pluginVersion: text('plugin_version'),
		isEmulator: boolean('is_emulator'),
		isProd: boolean('is_prod')
	},
	(t) => [
		index('stats_events_app_time_idx').on(t.appId, t.receivedAt),
		index('stats_events_app_action_time_idx').on(t.appId, t.action, t.receivedAt)
	]
);

export type App = typeof apps.$inferSelect;
export type Bundle = typeof bundles.$inferSelect;
export type NewBundle = typeof bundles.$inferInsert;
export type StatsEvent = typeof statsEvents.$inferSelect;
export type NewStatsEvent = typeof statsEvents.$inferInsert;
