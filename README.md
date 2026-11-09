# 사또 리밸런서

성장·대체·방어 자산을 시장 국면에 맞게 나누고, 분기마다 규칙대로 리밸런싱하는 자산배분 도구예요.
초대 코드가 있는 사람만 가입할 수 있고, 각자의 종목·금액은 본인만 볼 수 있어요.

- **시장·추천**: 고점 대비 낙폭과 VIX로 국면을 진단하고, 유형별 위험(변동성·위험 기여도)을 보여줘요.
- **내 포지션**: 종목·수량·평단가와 입출금·매수·매도 기록, 목표 비중 대비 증감 계산
- **누적 수익**: 저장 기록으로 쌓는 총자산·수익률 그래프와 관직 등급
- **모두의 포트폴리오**: 분기별 익명 통계(유형·비중·수익률)와 수익률 랭킹(직접 등록한 사람만)

> 이 사이트의 비중과 계산은 스스로 판단하기 위한 참고 자료이며 투자 권유가 아니에요.

## 구성 (모두 무료)

| 역할 | 서비스 |
|---|---|
| 화면 | GitHub Pages (`index.html`) |
| 회원·데이터 | Supabase (`supabase/schema.sql`) |
| 매일 시세 갱신 | GitHub Actions (`scripts/update-prices.mjs`) |

## 처음 설정하기

### 1. Supabase
1. https://supabase.com 에서 새 프로젝트를 만들어요 (Region: Northeast Asia (Seoul)).
2. **SQL Editor → New query**에 `supabase/schema.sql` 내용을 붙여넣고 **Run**.
3. **Authentication → Sign In / Providers → Email**에서 **Confirm email을 끄고** 저장해요.
4. **Project Settings → API**에서 아래 세 값을 확인해요.
   - Project URL
   - `anon` `public` 키 → `config.js`에 넣어요 (공개해도 되는 키)
   - `service_role` 키 → **절대 공개 금지**, 3번 GitHub Secrets에만 넣어요

### 2. config.js
`config.js`의 `url`, `anonKey`를 1-4의 값으로 바꿔요.

### 3. GitHub
1. **Settings → Secrets and variables → Actions → New repository secret**
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_KEY` = service_role 키
2. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `(root)` → Save
3. **Actions → 종가 갱신 → Run workflow**로 첫 시세를 받아요.

몇 분 뒤 `https://d4349709-cpu.github.io/satto-rebalancer/` 에서 열려요.

## 운영 메모
- **초대 코드 바꾸기** (SQL Editor): `update public.settings set value = '새코드' where key = 'invite_code';`
- **비밀번호 초기화**: `supabase/schema.sql` 맨 아래 주석의 SQL을 닉네임과 새 번호로 바꿔 실행해요.
- **시세**: 평일 15:45(한국 장 마감 후)와 07:10(미국 장 마감 후)에 자동 갱신돼요. 국내는 네이버 증권, 미국·지수·환율은 Yahoo Finance, 코인은 업비트 공개 시세를 써요. 비공식 경로라 가끔 실패할 수 있고, 실패한 종목은 Actions 실행 기록에 남아요. 금(KRX 금현물)은 국제 금 시세를 원화로 환산한 근삿값이에요.
- GitHub는 저장소에 60일 동안 변경이 없으면 자동 실행을 멈춰요. 멈췄다면 Actions 탭에서 다시 켜 주세요.
- Supabase 무료 프로젝트는 7일 동안 접속이 없으면 잠들어요. 대시보드에서 Restore를 누르면 다시 켜져요.
