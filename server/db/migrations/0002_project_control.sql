CREATE TABLE "project_progress_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"planned_pct" numeric(5, 2) NOT NULL,
	"actual_pct" numeric(5, 2) NOT NULL,
	"forecast_end_date" date,
	"summary" text,
	"risks" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_progress_pct_chk" CHECK ("project_progress_updates"."planned_pct" between 0 and 100 and "project_progress_updates"."actual_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "site_report_manpower" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_report_id" uuid NOT NULL,
	"trade" text NOT NULL,
	"company_id" uuid,
	"headcount" integer NOT NULL,
	CONSTRAINT "site_report_manpower_headcount_chk" CHECK ("site_report_manpower"."headcount" > 0)
);
--> statement-breakpoint
CREATE TABLE "site_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"site_id" uuid,
	"report_date" date NOT NULL,
	"status" text NOT NULL,
	"weather" text,
	"work_done" text DEFAULT '' NOT NULL,
	"issues" text,
	"delay_cause" text,
	"inspections" text,
	"visitors" text,
	"safety_incidents" integer DEFAULT 0 NOT NULL,
	"safety_notes" text,
	"created_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_reports_status_chk" CHECK ("site_reports"."status" in ('draft','submitted','reviewed','returned')),
	CONSTRAINT "site_reports_delay_chk" CHECK ("site_reports"."delay_cause" is null or "site_reports"."delay_cause" in ('consultant','client','subcontractor','material','labour','equipment','weather','authority','other')),
	CONSTRAINT "site_reports_incidents_chk" CHECK ("site_reports"."safety_incidents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "submittal_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"outcome" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "submittal_codes_project_code_unique" UNIQUE("project_id","code"),
	CONSTRAINT "submittal_codes_outcome_chk" CHECK ("submittal_codes"."outcome" in ('approved','approved_as_noted','revise_resubmit','rejected','for_information'))
);
--> statement-breakpoint
CREATE TABLE "submittal_items" (
	"submittal_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "submittal_items_submittal_id_item_id_pk" PRIMARY KEY("submittal_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "submittal_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submittal_id" uuid NOT NULL,
	"rev_no" integer NOT NULL,
	"submitted_date" date NOT NULL,
	"due_date" date NOT NULL,
	"transmittal_ref" text,
	"notes" text,
	"submitted_by" uuid NOT NULL,
	"returned_date" date,
	"code_id" uuid,
	"outcome" text,
	"consultant_comments" text,
	"reviewer_name" text,
	"inspection_date" date,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone,
	CONSTRAINT "submittal_revisions_rev_unique" UNIQUE("submittal_id","rev_no"),
	CONSTRAINT "submittal_revisions_response_chk" CHECK (("submittal_revisions"."returned_date" is null) = ("submittal_revisions"."outcome" is null) and ("submittal_revisions"."outcome" is null) = ("submittal_revisions"."code_id" is null)),
	CONSTRAINT "submittal_revisions_dates_chk" CHECK ("submittal_revisions"."due_date" >= "submittal_revisions"."submitted_date" and ("submittal_revisions"."returned_date" is null or "submittal_revisions"."returned_date" >= "submittal_revisions"."submitted_date"))
);
--> statement-breakpoint
CREATE TABLE "submittals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"discipline" text NOT NULL,
	"spec_section" text,
	"area" text,
	"subcontractor_id" uuid,
	"consultant_id" uuid,
	"required_by" date,
	"status" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submittals_number_unique" UNIQUE("number"),
	CONSTRAINT "submittals_type_chk" CHECK ("submittals"."type" in ('shop_drawing','material','sample','mockup','method_statement','other')),
	CONSTRAINT "submittals_discipline_chk" CHECK ("submittals"."discipline" in ('civil','structural','architectural','mechanical','electrical','plumbing','fire','landscape','other')),
	CONSTRAINT "submittals_status_chk" CHECK ("submittals"."status" in ('draft','with_consultant','revise_resubmit','rejected','approved','closed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "consultant_company_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "submittal_review_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_progress_updates" ADD CONSTRAINT "project_progress_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_progress_updates" ADD CONSTRAINT "project_progress_updates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_report_manpower" ADD CONSTRAINT "site_report_manpower_site_report_id_site_reports_id_fk" FOREIGN KEY ("site_report_id") REFERENCES "public"."site_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_report_manpower" ADD CONSTRAINT "site_report_manpower_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reports" ADD CONSTRAINT "site_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reports" ADD CONSTRAINT "site_reports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reports" ADD CONSTRAINT "site_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reports" ADD CONSTRAINT "site_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_codes" ADD CONSTRAINT "submittal_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_items" ADD CONSTRAINT "submittal_items_submittal_id_submittals_id_fk" FOREIGN KEY ("submittal_id") REFERENCES "public"."submittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_items" ADD CONSTRAINT "submittal_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_submittal_id_submittals_id_fk" FOREIGN KEY ("submittal_id") REFERENCES "public"."submittals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_code_id_submittal_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."submittal_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittal_revisions" ADD CONSTRAINT "submittal_revisions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_subcontractor_id_companies_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_consultant_id_companies_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submittals" ADD CONSTRAINT "submittals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_progress_project_idx" ON "project_progress_updates" USING btree ("project_id","as_of_date");--> statement-breakpoint
CREATE UNIQUE INDEX "site_reports_day_unique" ON "site_reports" USING btree ("project_id",coalesce("site_id", '00000000-0000-0000-0000-000000000000'::uuid),"report_date");--> statement-breakpoint
CREATE INDEX "submittal_items_item_idx" ON "submittal_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "submittals_project_idx" ON "submittals" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_consultant_company_id_companies_id_fk" FOREIGN KEY ("consultant_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_review_days_chk" CHECK ("projects"."submittal_review_days" between 1 and 90);--> statement-breakpoint
-- A consultant's recorded response is part of the project record: once a revision has an outcome
-- it cannot be changed or deleted. A correction is a new revision.
CREATE OR REPLACE FUNCTION edge_submittal_revision_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'submittal_revisions: a recorded consultant response cannot be changed (%)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER submittal_revisions_response_locked
  BEFORE UPDATE OR DELETE ON submittal_revisions
  FOR EACH ROW EXECUTE FUNCTION edge_submittal_revision_guard();
--> statement-breakpoint
CREATE TRIGGER project_progress_updates_append_only
  BEFORE UPDATE OR DELETE ON project_progress_updates
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
