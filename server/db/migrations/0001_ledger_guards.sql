-- Append-only guards. Posted stock movements, receipt/issue lines and audit events can never be
-- edited or deleted; corrections are made by posting new reversal/adjustment rows.
CREATE OR REPLACE FUNCTION edge_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER goods_receipt_lines_append_only
  BEFORE UPDATE OR DELETE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER stock_issue_lines_append_only
  BEFORE UPDATE OR DELETE ON stock_issue_lines
  FOR EACH ROW EXECUTE FUNCTION edge_forbid_mutation();
