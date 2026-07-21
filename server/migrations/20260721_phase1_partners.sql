begin;

create table if not exists "run-partners" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  discount_percentage numeric(5, 2) not null,
  status text not null default 'active',
  description text,
  created_at text not null default (now()::text),
  updated_at text not null default (now()::text),
  constraint "run-partners_slug_key" unique (slug),
  constraint "run-partners_discount_percentage_check"
    check (discount_percentage > 0 and discount_percentage <= 100),
  constraint "run-partners_status_check"
    check (status in ('active', 'inactive'))
);

create index if not exists "run-partners_status_idx" on "run-partners"(status);

commit;
