begin;

insert into "run-partner-audit-logs" (partner_id,action,new_data,metadata,created_at)
select p.id,'partner.created',jsonb_build_object('name',p.name,'slug',p.slug,'discountPercentage',p.discount_percentage,'status',p.status),jsonb_build_object('source','historical_backfill'),p.created_at
from "run-partners" p
where not exists (select 1 from "run-partner-audit-logs" l where l.partner_id=p.id and l.action='partner.created');

insert into "run-partner-audit-logs" (partner_id,action,registration_id,event_id,new_data,metadata,created_at)
select r.partner_id,'registration.started',r.id,r.event_id,jsonb_build_object('partnerName',r.partner_name,'partnerLink',r.partner_link),jsonb_build_object('source','historical_backfill'),coalesce(r.partner_identified_at,r.created_at)
from "run-registrations" r where r.partner_id is not null
and not exists (select 1 from "run-partner-audit-logs" l where l.registration_id=r.id and l.action='registration.started');

insert into "run-partner-audit-logs" (partner_id,action,registration_id,event_id,new_data,metadata,created_at)
select r.partner_id,'discount.applied',r.id,r.event_id,jsonb_build_object('discountPercentage',r.discount_percentage,'discountAmountCents',r.discount_amount,'originalPriceCents',r.original_price,'finalPriceCents',r.final_price),jsonb_build_object('source','historical_backfill'),r.created_at
from "run-registrations" r where r.partner_id is not null
and not exists (select 1 from "run-partner-audit-logs" l where l.registration_id=r.id and l.action='discount.applied');

insert into "run-partner-audit-logs" (partner_id,action,registration_id,event_id,new_data,metadata,created_at)
select r.partner_id,'payment.started',r.id,r.event_id,jsonb_build_object('provider',p.provider,'amountCents',p.amount_cents),jsonb_build_object('source','historical_backfill'),p.created_at
from "run-registrations" r join "run-payments" p on p.registration_id=r.id where r.partner_id is not null
and not exists (select 1 from "run-partner-audit-logs" l where l.registration_id=r.id and l.action='payment.started');

insert into "run-partner-audit-logs" (partner_id,action,registration_id,event_id,old_data,new_data,metadata,created_at)
select r.partner_id,'payment.approved',r.id,r.event_id,jsonb_build_object('status','pending_payment'),jsonb_build_object('status','paid','amountCents',r.final_price),jsonb_build_object('source','historical_backfill'),coalesce(r.paid_at,r.confirmed_at,r.updated_at)
from "run-registrations" r where r.partner_id is not null and r.status='paid'
and not exists (select 1 from "run-partner-audit-logs" l where l.registration_id=r.id and l.action='payment.approved');

insert into "run-partner-audit-logs" (partner_id,action,registration_id,event_id,new_data,metadata,created_at)
select r.partner_id,'payment.declined',r.id,r.event_id,jsonb_build_object('status',r.status),jsonb_build_object('source','historical_backfill'),r.updated_at
from "run-registrations" r where r.partner_id is not null and r.status='payment_failed'
and not exists (select 1 from "run-partner-audit-logs" l where l.registration_id=r.id and l.action='payment.declined');

insert into "run-partner-audit-logs" (partner_id,action,registration_id,event_id,new_data,metadata,created_at)
select r.partner_id,case when r.status='refunded' then 'payment.refunded' else 'registration.cancelled' end,r.id,r.event_id,jsonb_build_object('status',r.status),jsonb_build_object('source','historical_backfill'),r.updated_at
from "run-registrations" r where r.partner_id is not null and r.status in ('cancelled','refunded')
and not exists (select 1 from "run-partner-audit-logs" l where l.registration_id=r.id and l.action=case when r.status='refunded' then 'payment.refunded' else 'registration.cancelled' end);

commit;
