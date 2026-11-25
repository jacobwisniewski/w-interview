CREATE TABLE `bank_status` (
	`bank_slug` text PRIMARY KEY NOT NULL,
	`bank_name` text NOT NULL,
	`source_url` text NOT NULL,
	`cdr_version` text NOT NULL,
	`last_synced_at` text NOT NULL,
	`last_good_sync_run_id` integer,
	`degraded` integer DEFAULT false NOT NULL,
	`last_error` text,
	`valid_product_count` integer DEFAULT 0 NOT NULL,
	`quarantined_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`last_good_sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sync_run_id` integer NOT NULL,
	`bank_slug` text NOT NULL,
	`bank_name` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`last_updated` text,
	`overview_uri` text,
	`rate_type` text NOT NULL,
	`headline_rate_pct` real,
	`comparison_rate_pct` real,
	`annual_fee_cents` integer DEFAULT 0 NOT NULL,
	`upfront_fee_cents` integer DEFAULT 0 NOT NULL,
	`has_offset` integer DEFAULT false NOT NULL,
	`has_redraw` integer DEFAULT false NOT NULL,
	`review_status` text NOT NULL,
	`review_reasons_json` text NOT NULL,
	`raw_rate_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_products_run_bank_product` ON `products` (`sync_run_id`,`bank_slug`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_products_sync_run` ON `products` (`sync_run_id`);--> statement-breakpoint
CREATE INDEX `idx_products_bank_product` ON `products` (`bank_slug`,`product_id`);--> statement-breakpoint
CREATE TABLE `quarantined_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sync_run_id` integer NOT NULL,
	`bank_slug` text NOT NULL,
	`product_id` text,
	`reason` text NOT NULL,
	`raw_payload` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bank_slug` text NOT NULL,
	`bank_name` text NOT NULL,
	`source` text NOT NULL,
	`outcome` text NOT NULL,
	`cdr_version` text NOT NULL,
	`captured_at` text NOT NULL,
	`valid_count` integer DEFAULT 0 NOT NULL,
	`quarantined_count` integer DEFAULT 0 NOT NULL,
	`error_message` text
);
