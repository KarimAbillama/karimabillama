-- Integrity checks after a restore. Each query must return zero rows / true.
\echo '1. Stock balances equal the sum of the ledger (expect 0 rows)'
select b.item_id, b.location_id, b.status, b.qty, coalesce(m.q, 0) as ledger
from stock_balances b
left join (select item_id, location_id, status, sum(qty_delta) q from stock_movements group by 1,2,3) m
  on m.item_id = b.item_id and m.location_id = b.location_id and m.status = b.status
where b.qty <> coalesce(m.q, 0);

\echo '2. Append-only triggers are present (expect 4)'
select count(*) as append_only_triggers from pg_trigger where tgname like '%append_only';

\echo '3. Foreign keys are all validated (expect 0 rows)'
select conname from pg_constraint where contype = 'f' and not convalidated;

\echo '4. Users keep their roles and project memberships'
select (select count(*) from users) as users, (select count(*) from user_roles) as user_roles,
       (select count(*) from project_members) as project_members, (select count(*) from role_permissions) as role_permissions;

\echo '5. Document counts'
select (select count(*) from material_requests) as material_requests, (select count(*) from purchase_orders) as purchase_orders,
       (select count(*) from goods_receipts) as receipts, (select count(*) from stock_issues) as issues,
       (select count(*) from stock_movements) as ledger_rows, (select count(*) from audit_events) as audit_events;
