create table if not exists users (
  id text primary key,
  email text unique not null,
  name text not null,
  role text not null,
  phone text default '',
  password text default '',
  created_at timestamptz default now()
);

create table if not exists volunteers (
  id text primary key,
  userid text,
  name text not null,
  phone text default '',
  skills jsonb default '[]'::jsonb,
  availability text default 'AVAILABLE',
  location jsonb default '{"lat":0,"lng":0,"address":""}'::jsonb,
  vehicle text default 'None',
  current_assignment_ids jsonb default '[]'::jsonb,
  completed_missions integer default 0,
  experience_months integer default 0,
  created_at timestamptz default now()
);

create table if not exists requests (
  id text primary key,
  citizen_email text not null,
  citizen_name text,
  citizen_phone text,
  people_affected integer default 1,
  emergency_type text not null,
  required_resources jsonb default '[]'::jsonb,
  severity text default 'MEDIUM',
  description text default '',
  location jsonb default '{"lat":0,"lng":0,"address":""}'::jsonb,
  accessibility_requirements text default '',
  preferred_contact text default 'Phone',
  status text default 'NEW',
  assigned_volunteer_id text,
  allocated_resources jsonb default '[]'::jsonb,
  timeline jsonb default '[]'::jsonb,
  coordinator_notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists notifications (
  id text primary key,
  target_role text,
  target_user_id text,
  type text not null,
  title text not null,
  message text not null,
  related_request_id text,
  read_flag boolean default false,
  created_at timestamptz default now()
);

create table if not exists audit_log (
  id text primary key,
  actor text,
  action text not null,
  entity_type text not null,
  entity_id text,
  note text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  timestamp timestamptz default now()
);

create index if not exists idx_requests_status on requests(status);
create index if not exists idx_requests_email on requests(citizen_email);
create index if not exists idx_users_email on users(email);
create index if not exists idx_volunteers_user on volunteers(userid);

-- The backend currently uses the Supabase publishable key when a service-role
-- key is not configured, so the API needs explicit Data API policies.
alter table users enable row level security;
alter table volunteers enable row level security;
alter table requests enable row level security;
alter table notifications enable row level security;

drop policy if exists "api users access" on users;
create policy "api users access" on users for all to anon, authenticated using (true) with check (true);

drop policy if exists "api volunteers access" on volunteers;
create policy "api volunteers access" on volunteers for all to anon, authenticated using (true) with check (true);

drop policy if exists "api requests access" on requests;
create policy "api requests access" on requests for all to anon, authenticated using (true) with check (true);

drop policy if exists "api notifications access" on notifications;
create policy "api notifications access" on notifications for all to anon, authenticated using (true) with check (true);
