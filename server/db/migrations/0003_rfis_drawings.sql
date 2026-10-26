CREATE TABLE "drawing_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drawing_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"issue_date" date NOT NULL,
	"purpose" text NOT NULL,
	"transmittal_ref" text,
	"file_ref" text,
	"distribution" text,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawing_revisions_rev_unique" UNIQUE("drawing_id","revision"),
	CONSTRAINT "drawing_revisions_purpose_chk" CHECK ("drawing_revisions"."purpose" in ('tender','for_information','for_approval','for_construction','as_built'))
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"discipline" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawings_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "drawings_discipline_chk" CHECK ("drawings"."discipline" in ('civil','structural','architectural','mechanical','electrical','plumbing','fire','landscape','other'))
);
--> statement-breakpoint
CREATE TABLE "rfi_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rfi_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfi_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfi_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"response_date" date NOT NULL,
	"responder_name" text,
	"reference" text,
	"response" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"discipline" text NOT NULL,
	"subject" text NOT NULL,
	"question" text NOT NULL,
	"location" text,
	"drawing_revision_id" uuid,
	"boq_ref" text,
	"blocked_activity" text,
	"originator_id" uuid NOT NULL,
	"originator_company_id" uuid,
	"assignee_id" uuid,
	"recipient_company_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"cost_impact" text DEFAULT 'none' NOT NULL,
	"time_impact" text DEFAULT 'none' NOT NULL,
	"status" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"issue_date" date,
	"response_due_date" date,
	"transmittal_ref" text,
	"closed_date" date,
	"closure_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfis_number_unique" UNIQUE("number"),
	CONSTRAINT "rfis_status_chk" CHECK ("rfis"."status" in ('draft','internal_review','returned','issued','responded','closed','cancelled')),
	CONSTRAINT "rfis_priority_chk" CHECK ("rfis"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "rfis_impact_chk" CHECK ("rfis"."cost_impact" in ('none','possible','yes') and "rfis"."time_impact" in ('none','possible','yes')),
	CONSTRAINT "rfis_discipline_chk" CHECK ("rfis"."discipline" in ('civil','structural','architectural','mechanical','electrical','plumbing','fire','landscape','other')),
	CONSTRAINT "rfis_dates_chk" CHECK ("rfis"."response_due_date" is null or "rfis"."issue_date" is null or "rfis"."response_due_date" >= "rfis"."issue_date")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "rfi_response_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_drawing_id_drawings_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_events" ADD CONSTRAINT "rfi_events_rfi_id_rfis_id_fk" FOREIGN KEY ("rfi_id") REFERENCES "public"."rfis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_events" ADD CONSTRAINT "rfi_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_responses" ADD CONSTRAINT "rfi_responses_rfi_id_rfis_id_fk" FOREIGN KEY ("rfi_id") REFERENCES "public"."rfis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfi_responses" ADD CONSTRAINT "rfi_responses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_drawing_revision_id_drawing_revisions_id_fk" FOREIGN KEY ("drawing_revision_id") REFERENCES "public"."drawing_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_originator_id_users_id_fk" FOREIGN KEY ("originator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_originator_company_id_companies_id_fk" FOREIGN KEY ("originator_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfis" ADD CONSTRAINT "rfis_recipient_company_id_companies_id_fk" FOREIGN KEY ("recipient_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drawing_revisions_drawing_idx" ON "drawing_revisions" USING btree ("drawing_id","issue_date");--> statement-breakpoint
CREATE INDEX "rfi_events_rfi_idx" ON "rfi_events" USING btree ("rfi_id");--> statement-breakpoint
CREATE INDEX "rfi_responses_rfi_idx" ON "rfi_responses" USING btree ("rfi_id");--> statement-breakpoint
CREATE INDEX "rfis_project_idx" ON "rfis" USING btree ("project_id","status");--> statement-breakpoint
-- Drawing revisions, consultant RFI responses and RFI transitions are history: never edited or deleted.
CREATE TRIGGER drawing_revisions_append_only
  BEFORE UPDATE OR DELETE ON drawing_revisions
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rfi_responses_append_only
  BEFORE UPDATE OR DELETE ON rfi_responses
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rfi_events_append_only
  BEFORE UPDATE OR DELETE ON rfi_events
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
