-- 사또 리밸런서 데이터베이스 설정
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run 한 번이면 돼요.
-- 다시 실행해도 안전해요.

-- 1) 회원 닉네임
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nick text not null unique check (char_length(nick) between 2 and 12),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid())
$$;

drop function if exists public.join_satto(text, text);
create or replace function public.join_satto(p_nick text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.profiles(id, nick) values (auth.uid(), trim(p_nick));
end $$;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select using (id = auth.uid());

-- 2) 내 포트폴리오 (본인만 읽고 쓰기)
create table if not exists public.portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.portfolios enable row level security;
drop policy if exists "portfolio own" on public.portfolios;
create policy "portfolio own" on public.portfolios for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 3) 시장 지표·종목 시세 (누구나 읽기, 쓰기는 자동 갱신 스크립트만)
create table if not exists public.market (
  id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.prices (
  code text primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table public.market enable row level security;
alter table public.prices enable row level security;
drop policy if exists "market read" on public.market;
create policy "market read" on public.market for select using (true);
drop policy if exists "prices read" on public.prices;
create policy "prices read" on public.prices for select using (true);

-- 4) 시세를 받아올 종목 목록 (회원이 등록, 누구나 읽기)
create table if not exists public.tickers (
  code text primary key, name text, cls text, ccy text default 'KRW', added date default current_date);
alter table public.tickers enable row level security;
drop policy if exists "tickers read" on public.tickers;
create policy "tickers read" on public.tickers for select using (true);
drop policy if exists "tickers add" on public.tickers;
create policy "tickers add" on public.tickers for insert with check (public.is_member());

-- 5) 모두의 포트폴리오: 분기별 익명 통계 (회원끼리 읽기, 본인 것만 쓰기)
create table if not exists public.stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null, updated_at timestamptz not null default now());
alter table public.stats enable row level security;
drop policy if exists "stats read" on public.stats;
create policy "stats read" on public.stats for select using (public.is_member());
drop policy if exists "stats own" on public.stats;
create policy "stats own" on public.stats for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 6) 수익률 랭킹 (직접 등록한 사람만, 회원끼리 읽기)
create table if not exists public.ranking (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nick text not null, ret numeric not null, preset text, held int, mix jsonb, updated date);
alter table public.ranking enable row level security;
drop policy if exists "ranking read" on public.ranking;
create policy "ranking read" on public.ranking for select using (public.is_member());
drop policy if exists "ranking own" on public.ranking;
create policy "ranking own" on public.ranking for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 비밀번호(4자리) 초기화가 필요할 때 (닉네임과 새 번호를 바꿔서 실행):
-- update auth.users set encrypted_password = crypt('satto-pin-' || '1234', gen_salt('bf'))
--  where id = (select id from public.profiles where nick = '닉네임');
