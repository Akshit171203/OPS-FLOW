CREATE TYPE "public"."analysis_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."runbook_index_status" AS ENUM('PENDING', 'INDEXED', 'FAILED');--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" "analysis_status" DEFAULT 'QUEUED' NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"estimated_cost" numeric(12, 6),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runbook_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"runbook_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runbook_chunks_runbook_index_unique" UNIQUE("runbook_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "runbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"service_tag" text,
	"index_status" "runbook_index_status" DEFAULT 'PENDING' NOT NULL,
	"index_error" text,
	"indexed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbook_chunks" ADD CONSTRAINT "runbook_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbook_chunks" ADD CONSTRAINT "runbook_chunks_runbook_id_runbooks_id_fk" FOREIGN KEY ("runbook_id") REFERENCES "public"."runbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_incident_created_idx" ON "ai_analyses" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analyses_one_active_per_incident" ON "ai_analyses" USING btree ("incident_id") WHERE "ai_analyses"."status" IN ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "runbook_chunks_org_idx" ON "runbook_chunks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "runbook_chunks_embedding_hnsw" ON "runbook_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "runbooks_org_idx" ON "runbooks" USING btree ("organization_id");