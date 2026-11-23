CREATE TABLE "activity_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"activity_code" text NOT NULL,
	"as_of_date" date NOT NULL,
	"pct_complete" numeric(5, 2) NOT NULL,
	"actual_start" date,
	"actual_finish" date,
	"remark" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_progress_pct_chk" CHECK ("activity_progress"."pct_complete" between 0 and 100),
	CONSTRAINT "activity_progress_dates_chk" CHECK ("activity_progress"."actual_finish" is null or ("activity_progress"."actual_start" is not null and "activity_progress"."actual_finish" >= "activity_progress"."actual_start"))
);
--> statement-breakpoint
CREATE TABLE "boq_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"description" text NOT NULL,
	"unit" text,
	"qty" numeric(18, 4),
	"rate" numeric(18, 4),
	"amount" numeric(18, 2),
	"cost_code_id" uuid,
	"section" text,
	CONSTRAINT "boq_lines_line_unique" UNIQUE("contract_id","line_no"),
	CONSTRAINT "boq_lines_kind_chk" CHECK ("boq_lines"."kind" in ('heading','item','provisional_sum')),
	CONSTRAINT "boq_lines_shape_chk" CHECK (("boq_lines"."kind" = 'heading' and "boq_lines"."amount" is null and "boq_lines"."qty" is null)
    or ("boq_lines"."kind" = 'item' and "boq_lines"."unit" is not null and "boq_lines"."qty" > 0 and "boq_lines"."rate" >= 0 and "boq_lines"."amount" is not null)
    or ("boq_lines"."kind" = 'provisional_sum' and "boq_lines"."amount" is not null and "boq_lines"."qty" is null))
);
--> statement-breakpoint
CREATE TABLE "boq_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boq_line_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"qty_to_date" numeric(18, 4) NOT NULL,
	"remark" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boq_measurements_qty_chk" CHECK ("boq_measurements"."qty_to_date" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contract_securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"issuer" text,
	"amount" numeric(18, 2),
	"issue_date" date,
	"expiry_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"released_date" date,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_securities_kind_chk" CHECK ("contract_securities"."kind" in ('performance_bond','advance_payment_guarantee','retention_bond','car_insurance','third_party_insurance','workmen_compensation','professional_indemnity','other')),
	CONSTRAINT "contract_securities_status_chk" CHECK ("contract_securities"."status" in ('active','released') and ("contract_securities"."status" = 'released') = ("contract_securities"."released_date" is not null)),
	CONSTRAINT "contract_securities_amount_chk" CHECK (coalesce("contract_securities"."amount", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_no" text NOT NULL,
	"title" text,
	"form" text,
	"signed_date" date,
	"commencement_date" date,
	"completion_date" date,
	"contract_value" numeric(18, 2) NOT NULL,
	"retention_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"retention_limit_pct" numeric(5, 2),
	"advance_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"ld_per_day" numeric(18, 2),
	"ld_cap_pct" numeric(5, 2),
	"defects_liability_months" integer,
	"payment_terms_days" integer,
	"notes" text,
	"boq_status" text DEFAULT 'none' NOT NULL,
	"boq_source_name" text,
	"boq_confirmed_at" timestamp with time zone,
	"boq_confirmed_by" uuid,
	"boq_confirm_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_project_unique" UNIQUE("project_id"),
	CONSTRAINT "contracts_boq_status_chk" CHECK ("contracts"."boq_status" in ('none','draft','confirmed')),
	CONSTRAINT "contracts_pct_chk" CHECK ("contracts"."retention_pct" between 0 and 100 and "contracts"."advance_pct" between 0 and 100 and coalesce("contracts"."retention_limit_pct", 0) between 0 and 100 and coalesce("contracts"."ld_cap_pct", 0) between 0 and 100),
	CONSTRAINT "contracts_value_chk" CHECK ("contracts"."contract_value" >= 0 and coalesce("contracts"."ld_per_day", 0) >= 0),
	CONSTRAINT "contracts_dates_chk" CHECK ("contracts"."completion_date" is null or "contracts"."commencement_date" is null or "contracts"."completion_date" >= "contracts"."commencement_date")
);
--> statement-breakpoint
CREATE TABLE "programme_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baseline_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"wbs_code" text,
	"wbs_name" text,
	"planned_start" date NOT NULL,
	"planned_finish" date NOT NULL,
	"duration_days" integer NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"weight" numeric(18, 4) NOT NULL,
	CONSTRAINT "programme_activities_code_unique" UNIQUE("baseline_id","code"),
	CONSTRAINT "programme_activities_dates_chk" CHECK ("programme_activities"."planned_finish" >= "programme_activities"."planned_start"),
	CONSTRAINT "programme_activities_weight_chk" CHECK ("programme_activities"."weight" >= 0)
);
--> statement-breakpoint
CREATE TABLE "programme_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"p6_project_code" text,
	"data_date" date,
	"planned_start" date NOT NULL,
	"planned_finish" date NOT NULL,
	"activity_count" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"notes" text,
	"imported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programme_baselines_source_chk" CHECK ("programme_baselines"."source" in ('p6_xer','csv'))
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"project_id" uuid NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"note" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budgets_project_id_cost_code_id_pk" PRIMARY KEY("project_id","cost_code_id"),
	CONSTRAINT "project_budgets_amount_chk" CHECK ("project_budgets"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "activity_progress" ADD CONSTRAINT "activity_progress_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_progress" ADD CONSTRAINT "activity_progress_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_measurements" ADD CONSTRAINT "boq_measurements_boq_line_id_boq_lines_id_fk" FOREIGN KEY ("boq_line_id") REFERENCES "public"."boq_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_measurements" ADD CONSTRAINT "boq_measurements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_securities" ADD CONSTRAINT "contract_securities_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_securities" ADD CONSTRAINT "contract_securities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_boq_confirmed_by_users_id_fk" FOREIGN KEY ("boq_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_activities" ADD CONSTRAINT "programme_activities_baseline_id_programme_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."programme_baselines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_baselines" ADD CONSTRAINT "programme_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_baselines" ADD CONSTRAINT "programme_baselines_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_progress_project_idx" ON "activity_progress" USING btree ("project_id","activity_code","as_of_date");--> statement-breakpoint
CREATE INDEX "boq_measurements_line_idx" ON "boq_measurements" USING btree ("boq_line_id","as_of_date");--> statement-breakpoint
CREATE INDEX "contract_securities_contract_idx" ON "contract_securities" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "programme_baselines_current_unique" ON "programme_baselines" USING btree ("project_id") WHERE "programme_baselines"."is_current";--> statement-breakpoint
-- Programme activities, site progress and BOQ measurements are history: never edited or deleted.
CREATE TRIGGER programme_activities_append_only
  BEFORE UPDATE OR DELETE ON programme_activities
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER activity_progress_append_only
  BEFORE UPDATE OR DELETE ON activity_progress
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER boq_measurements_append_only
  BEFORE UPDATE OR DELETE ON boq_measurements
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
-- A confirmed contract BOQ is frozen: changes go through variations.
CREATE OR REPLACE FUNCTION edge_boq_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT boq_status INTO st FROM contracts WHERE id = COALESCE(NEW.contract_id, OLD.contract_id);
  IF st = 'confirmed' THEN
    RAISE EXCEPTION 'The contract BOQ is confirmed and cannot be changed (use a variation)' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER boq_lines_frozen_when_confirmed
  BEFORE INSERT OR UPDATE OR DELETE ON boq_lines
  FOR EACH ROW EXECUTE FUNCTION edge_boq_guard();
--> statement-breakpoint
-- Once confirmed, a BOQ cannot go back to draft.
CREATE OR REPLACE FUNCTION edge_contract_boq_status_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.boq_status = 'confirmed' AND NEW.boq_status <> 'confirmed' THEN
    RAISE EXCEPTION 'A confirmed contract BOQ cannot be reopened' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contracts_boq_status_guard
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION edge_contract_boq_status_guard();
