CREATE TYPE "public"."deployment_status" AS ENUM('SUCCESS', 'FAILED', 'ROLLED_BACK', 'IN_PROGRESS');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('DEBUG', 'INFO', 'WARN', 'ERROR');--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"version" text NOT NULL,
	"commit_sha" text NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"deployed_by" text NOT NULL,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "deployment_status" DEFAULT 'SUCCESS' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_deployments" (
	"incident_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"linked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_deployments_unique" UNIQUE("incident_id","deployment_id")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"incident_id" uuid,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"error_rate" double precision NOT NULL,
	"latency_ms" integer NOT NULL,
	"requests_per_min" integer NOT NULL,
	"health_status" "service_status" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_error_rate_check" CHECK ("metrics"."error_rate" >= 0 AND "metrics"."error_rate" <= 1)
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deployments" ADD CONSTRAINT "incident_deployments_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deployments" ADD CONSTRAINT "incident_deployments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deployments" ADD CONSTRAINT "incident_deployments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deployments" ADD CONSTRAINT "incident_deployments_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_service_deployed_idx" ON "deployments" USING btree ("service_id","deployed_at");--> statement-breakpoint
CREATE INDEX "logs_service_timestamp_idx" ON "logs" USING btree ("service_id","timestamp");--> statement-breakpoint
CREATE INDEX "logs_incident_timestamp_idx" ON "logs" USING btree ("incident_id","timestamp");--> statement-breakpoint
CREATE INDEX "logs_org_timestamp_idx" ON "logs" USING btree ("organization_id","timestamp");--> statement-breakpoint
CREATE INDEX "metrics_service_captured_idx" ON "metrics" USING btree ("service_id","captured_at");