CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"doc_number" text NOT NULL,
	"doc_revision" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"amount" numeric(18, 2),
	"rule_id" uuid,
	"status" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "approval_requests_status_chk" CHECK ("approval_requests"."status" in ('pending','approved','rejected','superseded'))
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"project_id" uuid,
	"min_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"max_amount" numeric(18, 2),
	"step_role_keys" jsonb NOT NULL,
	"allow_self_approval" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"role_key" text NOT NULL,
	"status" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"doc_revision" integer NOT NULL,
	CONSTRAINT "approval_steps_request_step_unique" UNIQUE("request_id","step_no"),
	CONSTRAINT "approval_steps_status_chk" CHECK ("approval_steps"."status" in ('waiting','pending','approved','rejected','cancelled')),
	CONSTRAINT "approval_steps_reject_reason" CHECK ("approval_steps"."status" <> 'rejected' or coalesce(length(trim("approval_steps"."comment")),0) > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"project_id" uuid,
	"details" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"trn" text,
	"address" text,
	"phone" text,
	"email" text,
	"is_client" boolean DEFAULT false NOT NULL,
	"is_consultant" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"is_subcontractor" boolean DEFAULT false NOT NULL,
	"payment_terms" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cost_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cost_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"po_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_received_base" numeric(18, 4) NOT NULL,
	"qty_accepted_base" numeric(18, 4) NOT NULL,
	"qty_rejected_base" numeric(18, 4) NOT NULL,
	"rejection_reason" text,
	"unit_cost_base" numeric(18, 4) NOT NULL,
	CONSTRAINT "grn_lines_split" CHECK ("goods_receipt_lines"."qty_accepted_base" >= 0 and "goods_receipt_lines"."qty_rejected_base" >= 0 and "goods_receipt_lines"."qty_accepted_base" + "goods_receipt_lines"."qty_rejected_base" = "goods_receipt_lines"."qty_received_base" and "goods_receipt_lines"."qty_received_base" > 0),
	CONSTRAINT "grn_lines_reject_reason" CHECK ("goods_receipt_lines"."qty_rejected_base" = 0 or coalesce(length(trim("goods_receipt_lines"."rejection_reason")),0) > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delivery_note_ref" text,
	"received_date" date NOT NULL,
	"received_by" uuid NOT NULL,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_number_unique" UNIQUE("number"),
	CONSTRAINT "goods_receipts_idem_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "item_unit_conversions" (
	"item_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"base_units_per_unit" numeric(24, 10) NOT NULL,
	CONSTRAINT "item_unit_conversions_item_id_unit_code_pk" PRIMARY KEY("item_id","unit_code"),
	CONSTRAINT "iuc_positive" CHECK ("item_unit_conversions"."base_units_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "item_valuations" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"avg_unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"valued_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_valuations_nonneg" CHECK ("item_valuations"."valued_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"specification" text,
	"brand" text,
	"base_unit" text NOT NULL,
	"purchase_unit" text,
	"min_stock" numeric(18, 4),
	"reorder_level" numeric(18, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"project_id" uuid,
	"site_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code"),
	CONSTRAINT "locations_type_chk" CHECK ("locations"."type" in ('warehouse','site_store','transit')),
	CONSTRAINT "locations_site_store_project_chk" CHECK ("locations"."type" <> 'site_store' or "locations"."project_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "material_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"cost_code_id" uuid NOT NULL,
	"remarks" text,
	CONSTRAINT "mr_lines_line_no_unique" UNIQUE("material_request_id","line_no"),
	CONSTRAINT "mr_lines_qty_positive" CHECK ("material_request_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "material_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"site_id" uuid,
	"required_date" date NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"purpose" text,
	"requested_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "material_requests_status_chk" CHECK ("material_requests"."status" in ('draft','pending_approval','approved','rejected','cancelled','closed'))
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text NOT NULL,
	"trn" text,
	"base_currency" text DEFAULT 'AED' NOT NULL,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"inventory_valuation_method" text DEFAULT 'WAC' NOT NULL,
	"valuation_method_confirmed" boolean DEFAULT false NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	CONSTRAINT "organization_settings_singleton" CHECK ("organization_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"client_company_id" uuid,
	"contract_ref" text,
	"location_text" text,
	"plot_no" text,
	"authority_jurisdiction" text,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"planned_end_date" date,
	"contract_value" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "projects_status_chk" CHECK ("projects"."status" in ('planning','active','on_hold','completed','closed'))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"mr_line_id" uuid,
	"cost_code_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"qty_base" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"vat_code" text NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"line_net" numeric(18, 2) NOT NULL,
	"line_vat" numeric(18, 2) NOT NULL,
	"qty_cancelled_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "po_lines_line_no_unique" UNIQUE("purchase_order_id","line_no"),
	CONSTRAINT "po_lines_qty_positive" CHECK ("purchase_order_lines"."qty" > 0 and "purchase_order_lines"."qty_base" > 0),
	CONSTRAINT "po_lines_price_nonneg" CHECK ("purchase_order_lines"."unit_price" >= 0),
	CONSTRAINT "po_lines_vat_code_chk" CHECK ("purchase_order_lines"."vat_code" in ('SR','ZR','EX','OOS')),
	CONSTRAINT "po_lines_cancel_range" CHECK ("purchase_order_lines"."qty_cancelled_base" >= 0 and "purchase_order_lines"."qty_cancelled_base" <= "purchase_order_lines"."qty_base")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"delivery_location_id" uuid NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"required_date" date,
	"promised_date" date,
	"payment_terms" text,
	"supplier_quote_ref" text,
	"notes" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "purchase_orders_status_chk" CHECK ("purchase_orders"."status" in ('draft','pending_approval','approved','rejected','partially_received','received','closed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"mr_line_id" uuid NOT NULL,
	"qty" numeric(18, 4) NOT NULL,
	"qty_consumed" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_qty_positive" CHECK ("reservations"."qty" > 0),
	CONSTRAINT "reservations_consumed_range" CHECK ("reservations"."qty_consumed" >= 0 and "reservations"."qty_consumed" <= "reservations"."qty"),
	CONSTRAINT "reservations_status_chk" CHECK ("reservations"."status" in ('active','consumed','released'))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"all_projects" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "sites_project_code_unique" UNIQUE("project_id","code")
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "stock_balances_item_id_location_id_status_pk" PRIMARY KEY("item_id","location_id","status"),
	CONSTRAINT "stock_balances_nonnegative" CHECK ("stock_balances"."qty" >= 0),
	CONSTRAINT "stock_balances_status_chk" CHECK ("stock_balances"."status" in ('available','quarantine','rejected','in_transit','discrepancy'))
);
--> statement-breakpoint
CREATE TABLE "stock_issue_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_issue_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"mr_line_id" uuid,
	"cost_code_id" uuid NOT NULL,
	"qty_base" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	CONSTRAINT "stock_issue_lines_qty_positive" CHECK ("stock_issue_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"site_id" uuid,
	"location_id" uuid NOT NULL,
	"issued_to" text NOT NULL,
	"issue_date" date NOT NULL,
	"issued_by" uuid NOT NULL,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_issues_number_unique" UNIQUE("number"),
	CONSTRAINT "stock_issues_idem_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"movement_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text NOT NULL,
	"qty_delta" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"value_delta" numeric(18, 2) DEFAULT '0' NOT NULL,
	"project_id" uuid,
	"cost_code_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_line_id" uuid,
	"source_number" text NOT NULL,
	"movement_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid NOT NULL,
	"note" text,
	CONSTRAINT "stock_movements_seq_unique" UNIQUE("seq"),
	CONSTRAINT "stock_movements_nonzero" CHECK ("stock_movements"."qty_delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"mr_line_id" uuid,
	"qty_dispatched" numeric(18, 4) NOT NULL,
	"qty_received" numeric(18, 4),
	"qty_discrepancy" numeric(18, 4),
	"discrepancy_status" text DEFAULT 'none' NOT NULL,
	"discrepancy_note" text,
	"discrepancy_resolved_by" uuid,
	"discrepancy_resolved_at" timestamp with time zone,
	CONSTRAINT "stl_qty_positive" CHECK ("stock_transfer_lines"."qty_dispatched" > 0),
	CONSTRAINT "stl_received_range" CHECK ("stock_transfer_lines"."qty_received" is null or ("stock_transfer_lines"."qty_received" >= 0 and "stock_transfer_lines"."qty_received" + coalesce("stock_transfer_lines"."qty_discrepancy",0) = "stock_transfer_lines"."qty_dispatched")),
	CONSTRAINT "stl_discrepancy_status_chk" CHECK ("stock_transfer_lines"."discrepancy_status" in ('none','open','written_off','found'))
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"status" text NOT NULL,
	"dispatch_date" date NOT NULL,
	"dispatched_by" uuid NOT NULL,
	"received_date" date,
	"received_by" uuid,
	"vehicle_ref" text,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"receive_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_number_unique" UNIQUE("number"),
	CONSTRAINT "stock_transfers_idem_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "stock_transfers_recv_idem_unique" UNIQUE("receive_idempotency_key"),
	CONSTRAINT "stock_transfers_distinct" CHECK ("stock_transfers"."from_location_id" <> "stock_transfers"."to_location_id"),
	CONSTRAINT "stock_transfers_status_chk" CHECK ("stock_transfers"."status" in ('in_transit','received','received_with_discrepancy'))
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"factor_to_reference" numeric(24, 10)
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"job_title" text,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_unit_conversions" ADD CONSTRAINT "item_unit_conversions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_unit_conversions" ADD CONSTRAINT "item_unit_conversions_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_valuations" ADD CONSTRAINT "item_valuations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_base_unit_units_code_fk" FOREIGN KEY ("base_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_unit_units_code_fk" FOREIGN KEY ("purchase_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_material_request_id_material_requests_id_fk" FOREIGN KEY ("material_request_id") REFERENCES "public"."material_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_company_id_companies_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_mr_line_id_material_request_lines_id_fk" FOREIGN KEY ("mr_line_id") REFERENCES "public"."material_request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_companies_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_delivery_location_id_locations_id_fk" FOREIGN KEY ("delivery_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_mr_line_id_material_request_lines_id_fk" FOREIGN KEY ("mr_line_id") REFERENCES "public"."material_request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_stock_issue_id_stock_issues_id_fk" FOREIGN KEY ("stock_issue_id") REFERENCES "public"."stock_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_mr_line_id_material_request_lines_id_fk" FOREIGN KEY ("mr_line_id") REFERENCES "public"."material_request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_lines" ADD CONSTRAINT "stock_issue_lines_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cost_code_id_cost_codes_id_fk" FOREIGN KEY ("cost_code_id") REFERENCES "public"."cost_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_stock_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("stock_transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_mr_line_id_material_request_lines_id_fk" FOREIGN KEY ("mr_line_id") REFERENCES "public"."material_request_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_discrepancy_resolved_by_users_id_fk" FOREIGN KEY ("discrepancy_resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_doc_idx" ON "approval_requests" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_project_idx" ON "audit_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "grn_lines_po_line_idx" ON "goods_receipt_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "material_requests_project_idx" ON "material_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "po_lines_mr_line_idx" ON "purchase_order_lines" USING btree ("mr_line_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_project_idx" ON "purchase_orders" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "reservations_item_loc_idx" ON "reservations" USING btree ("item_id","location_id","status");--> statement-breakpoint
CREATE INDEX "reservations_mr_line_idx" ON "reservations" USING btree ("mr_line_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_issue_lines_mr_line_idx" ON "stock_issue_lines" USING btree ("mr_line_id");--> statement-breakpoint
CREATE INDEX "stock_issues_project_idx" ON "stock_issues" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "stock_movements_item_loc_idx" ON "stock_movements" USING btree ("item_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_movements_project_idx" ON "stock_movements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "stock_movements_source_idx" ON "stock_movements" USING btree ("source_type","source_id");