insert into "run-partners" (name, slug, discount_percentage, status)
values
  ('Runners Club', 'runners', 10, 'active'),
  ('Pace Team', 'pace', 10, 'active'),
  ('Alpha Running', 'alpha', 10, 'active')
on conflict (slug) do update set
  name = excluded.name,
  discount_percentage = excluded.discount_percentage,
  status = excluded.status,
  updated_at = now()::text;
