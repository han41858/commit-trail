# Commit Trail 개발·운영 가이드

Commit Trail은 React, TypeScript, Vite, Canvas 2D로 GitHub 커밋 DAG를 표시하는 읽기 전용 웹앱이다.
별도 백엔드나 데이터베이스 없이 동작한다. 제품 소개와 화면은 [README](../README.md),
기능별 규칙은 [문서 안내](README.md)에 연결한 전용 명세에서 확인한다.

## 개발 환경과 검증

[`.nvmrc`](../.nvmrc)와 [`package.json`](../package.json)의 `engines.node`에 맞춰 Node.js **24.x**와 npm을 사용한다.
`npm ci`로 잠금 파일에 맞춰 의존성을 설치하고 `npm run dev`로 개발 서버를 시작한다.

```sh
npm ci
npm run dev
```

`npm run format:check`는 파일을 고치지 않고 검사한다. `npm test`는 하위 모듈을 포함해 `src/**/*.test.ts`를 실행하고,
`node --test --test-isolation=none .github/scripts/*.test.mjs`는 저장소 자동화를 검증한다.
`npm run build`는 TypeScript 검사와 Vite 빌드를 실행하며, `npm run preview -- --port 4173`으로 빌드 결과를 로컬에서 확인한다.

```sh
npm run format:check
npm test
node --test --test-isolation=none .github/scripts/*.test.mjs
npm run build
npm run preview -- --port 4173
```

포맷은 `package.json`에 고정한 Prettier `3.9.10`과 `prettier.config.mjs`의 공통 설정을 사용한다.
`npm run format`은 저장소에서 지원하는 파일에 포맷을 적용한다. 생성물, 로컬 캐시와 npm이 관리하는
`package-lock.json`은 `.prettierignore`로 제외하며 별도 플러그인이나 Git 훅은 필요하지 않다.
문서만 변경해도 PR CI는 포맷을 검사한다.

빌드 산출물 `dist/`는 정적 호스트에서 제공할 수 있다. `?repo=owner%2Frepo`로 저장소를 지정하므로
별도 서버 rewrite 없이 새로고침해도 선택을 복원한다.

**Options** 하단에는 빌드 시각을 오른쪽에 `Built at`으로 표시한다. Vite가 빌드 때 삽입한 UTC 시각 하나를
브라우저 현지 날짜와 시간대의 24시간제 `HH:mm`으로 표시하며 AM/PM·초·시간대 이름은 붙이지 않는다.
같은 빌드에서는 오프라인이나 새로고침 후에도 시각이 바뀌지 않는다. 메뉴는 화면 안에서 한 줄을 유지하도록
넓어지고, 공간이 부족하면 말줄임과 툴팁을 사용한다. 캐시된 PWA는 업데이트를 적용할 때까지 이전 시각을
유지한다. 같은 커밋을 다시 빌드해도 시각과 번들 해시가 바뀌므로 PWA 업데이트가 생길 수 있다.
개발 서버는 `Development`를 표시한다.

## 제품 이름과 브라우저 데이터

제품과 Vercel 프로젝트 이름은 각각 **Commit Trail**과 `commit-trail`이다. GitHub 저장소는
`han41858/commit-trail`, Production 도메인은 `https://commit-trail-view.vercel.app/`이다.
저장소·프로젝트·도메인은 각 서비스의 대시보드에서 관리하며 소스 이름을 바꿔도 외부 리소스는 바뀌지 않는다.
설정을 점검할 때는 기존 프로젝트 ID·팀 소유권·Git 배포 설정을 유지하고, 저장소 연결과 Production Branch
`main`, 공개 도메인을 확인한다.

PAT, 최근 저장소, 브랜치 선택, Split view 구성과 표시 옵션은 `commit-trail.*` localStorage 키를 사용한다.
`commit-trail.view-options`는 `theme`, `autoRefresh`, `interval`을 저장한다. 이전 제품의 키는 읽거나
이전하지 않으므로 사용자가 토큰을 다시 입력하고 저장소와 옵션을 설정한다. 도메인이 달라져도 localStorage,
Service Worker와 PWA 설치가 분리된다. 링크·리디렉션·분석을 통해 토큰이나 설정을 이전하지 않는다.
PWA 매니페스트의 표시 이름은 Commit Trail이며 `id`, `start_url`, `scope`는 모두 `/`이다.

<a name="anonymous-web-analytics"></a>

## 익명 웹 분석

Production에서는 공식 `@vercel/analytics/react` 컴포넌트로 Vercel Web Analytics의 페이지 조회만 수집한다.
앱은 사용자 동작에 대한 커스텀 이벤트를 보내거나 Google Analytics를 연동하지 않는다. 분석이 실패하거나
차단돼도 GitHub 이력 조회를 막지 않는다.

`beforeSend`는 URL의 검색 파라미터·fragment·인증 정보를 제거하며, 잘못된 URL이나 HTTP(S)가 아닌 URL은
전송하지 않는다. 비공개 이름이 포함될 수 있는 `repo`와 `branch` 역시 전송 URL에서 제거한다. 문서당 첫
페이지 조회만 집계하므로 같은 문서에서 저장소·브랜치·Split view 순서나 브라우저 이력을 바꿔도 집계가 늘지
않는다. PAT, GitHub API 응답, 커밋 상세와 선택한 저장소 이름을 커스텀 이벤트로 보내지 않는다.

`Referrer-Policy: no-referrer`와 제한적인 CSP를 유지한다. 분석 스크립트와 수집 경로는 Vercel 배포의 같은
출처에서 제공해야 한다. 앱은 쿠키나 사용자 식별자를 추가하지 않지만 Vercel이 요청 수준 메타데이터를 받지
않는다는 보장은 아니다. 활성화 전에 Vercel 문서와 적용되는 개인정보 보호 요구사항을 확인한다.

분석은 Vercel 프로젝트의 **commit-trail → Analytics → Enable**에서 별도로 활성화하고 Production에 배포한다.
브라우저 Network 패널에서 스크립트와 페이지 조회 요청을 확인하고 `repo`·`branch` 값이 전송되지 않는지,
같은 문서에서 저장소 전환이나 Split view 재정렬 후 조회 수가 늘지 않는지 점검한다. 브라우저 확장과 네트워크
필터가 수집을 막을 수 있다. 새 커스텀 이벤트는 별도 개인정보 검토 없이 추가하지 않는다.

## 링크 미리보기와 검색 메타데이터

`index.html`의 초기 HTML에 제품 제목·설명·canonical URL·Open Graph 메타데이터·X `summary` 카드를 제공한다.
크롤러는 JavaScript를 실행하거나 GitHub API를 호출할 필요가 없다. 두 카드 모두 공개 512×512 정사각형 PNG
로고 `https://commit-trail-view.vercel.app/icons/app-logo-512.png`를 사용한다.

단일 저장소와 Split view 링크의 쿼리는 앱에서 그대로 사용하지만, 미리보기는 항상 Commit Trail을 소개한다.
canonical URL과 `og:url`은 공개 Production 루트이며 저장소 이름·PAT·기타 쿼리 값은 메타데이터에 넣지 않는다.
`public/robots.txt`는 크롤링을 허용하고 제품 루트만 나열하는 `public/sitemap.xml`을 안내한다.

배포 후 `/`, `/?repo=owner/repo`, `repo`가 반복되는 Split view URL의 원본 HTML을 JavaScript 실행 없이 확인한다.
이미지 URL, `/robots.txt`, `/sitemap.xml`의 공개 응답과 콘텐츠 유형을 점검한다. Vercel Preview 보호와 자동
`noindex` 동작은 유지하므로 채팅 미리보기는 공개 Production URL로 확인한다. 이미 붙여 넣은 링크는 서비스가
다시 가져올 때까지 캐시된 카드를 표시할 수 있다. 메타데이터는 카드 데이터를 제공할 뿐, 외부 서비스의 표시
여부나 형식을 보장하지 않는다.

## 사용 방법

1. `owner/repo` 또는 `https://github.com/owner/repo`를 입력하고 제출해 저장소를 연다. Owner 이름만 제출하면 [저장소 목록](#owner-저장소-선택)을 연다. 입력을 지워도 현재 그래프는 유지한다.
2. **Branch**에서 기준 브랜치를 선택한다. **↓ Older** 또는 **↓ Newer**로 아래쪽에 이어질 이력 방향을 바꾸고, 커밋을 선택해 상세를 확인한다.
3. 비공개 저장소는 **Token**에서 해당 저장소에 한정한 fine-grained PAT를 적용한다. 권한 확인, API 한도, 저장·삭제 정책은 [제품 명세의 공개·비공개 저장소](specification.md#22-공개비공개-저장소)를 따른다. 공유 URL에 PAT는 포함하지 않지만 비공개 저장소와 브랜치 이름은 노출한다.

브랜치 선택과 점진적 로딩은 [제품 명세](specification.md)에서 설명한다. 기능별 세부 규칙은 [Split view](monitor-mode.md), [최근 저장소](recent-repositories.md), [날짜 구분선](date-separators.md), [개발자 진단](developer-debug-mode.md) 명세를 따른다.

## Owner 저장소 선택

GitHub 사용자나 조직 이름을 제출하면 공개 목록과 적용한 PAT로 조회할 수 있는 목록을 합쳐 이름순으로 표시한다. 일반 화면에서는 한 항목을 바로 열고, Split view에서는 체크한 항목을 **Add N repositories**로 일괄 추가한다.

명시적 조회, **Load more**, 소스별 오류와 재시도, 취소 및 메모리 캐시의 수명은 [Owner 저장소 선택 명세](owner-repositories.md)를 따른다.

## DAG 경로 강조와 선택

배지·커밋·연결선에 포인터를 올리면 현재 조회한 경로와 경계를 임시로 강조한다. 배지나 선을 클릭·탭하면 경로만 고정하고, 커밋 노드·메시지·버전 아이콘을 선택하면 상세도 연다.

경로 소유권, 색상 배정, 강조 범위와 입력 수명은 [DAG 경로 명세](dag-hover-highlight.md)를 따른다. 그래프 배치와 브랜치 선택은 [제품 명세](specification.md)를 따른다.

<a name="architecture-and-limits"></a>

## 코드 구조와 기술적 한계

`src/main.tsx`가 진입점이며 앱 상태·인증·내비게이션·갱신 수명을 관리한다. 화면 컨트롤은 명시적인 props로
상태를 받아 렌더링하고 별도 세션이나 구독을 만들지 않는다. `PopupBackdrop.tsx`는 토큰·설정·Split view
팝업의 배경과 포인터 처리를 공유한다. 설정 패널은 헤더 밖에 렌더링해 배경이 앱 전체를 덮도록 한다.
파일은 관련 기능별로 모으고 스타일과 테스트를 구현 옆에 두며 모듈은 명시적 상대 경로로 가져온다.

- `src/app/`은 공통 화면·알림·표시 옵션·분석·전역 스타일을, `src/app/pwa/`는 앱 업데이트를 담당한다.
- `src/graph/`는 그래프 렌더링·입력·경로 강조·커밋 상세를 담당한다. `Graph.tsx`는 배치·입력·스크롤·
  애니메이션을 조정하고 `graphCanvas.ts`는 DPR을 반영해 그린 배지와 메시지의 클릭 판정 범위를 반환한다.
  Canvas는 선택 상태나 요청 수명을 소유하지 않는다.
- `src/repository/`는 저장소와 브랜치 선택, Owner 조회, 내비게이션, 이력·메타데이터를 담당한다.
  `history.ts`가 탐색 방향·페이지 요청·취소를 조정하고, `HistoryCommitPages.ts`가 요청 풀·중복 제거·불변
  페이지 캐시·HEAD 검증을 맡는다. `historyTraversal.ts`는 탐색 경계·조회 범위·조상 관계를 계산한다.
- `src/monitor/`는 Split view의 선택·정렬·세션·열·상세 위치를, `src/token/`은 토큰 저장·권한 검사·
  토큰 컨트롤을 담당한다.
- `src/shared/`는 공통 Git 모델과 이모지 변환, `github/`·`refresh/`·`debug/`·`ui/`의 공통 기능을 담당한다.
  `model.ts`는 SHA로 중복을 제거하고 날짜가 아닌 부모 관계로 위상 배치를 계산한다. 가능한 경우 부모 레인과
  이전 배치를 재사용한다. `src/shared/github/api.ts`는 페이지 단위 REST 요청을 담당한다.

브랜치 참조·경로·화면 레인은 별개다. `graphColors.ts`는 배치와 별도로 색상을 결정하고 강조와 배지 트랙에
같은 경로 ID를 사용한다. 페이지 추가로 경계나 인접 관계가 바뀌면 색이 달라질 수 있지만, 최종 스냅샷과 기준
HEAD가 같으면 새 브라우저에서도 같은 색을 배정한다. `branchLabels.ts`는 브랜치 HEAD뿐 아니라 가시 곡선
구간에도 라벨을 배치한다. 상세 규칙은 [경로 색상과 하이라이트](dag-hover-highlight.md)와
[월·일 날짜 구분선](date-separators.md)을 따른다. 날짜 구분선은 별도 설정·의존성·API 요청을 추가하지 않는다.

Canvas는 뷰포트와 작은 여유 영역만 그리지만 배치와 선 탐색은 메모리에 올라온 이력을 처리한다.
합성 커밋 10,000개를 자동 테스트로 검증하며, 실제 대형 저장소와 100,000개 커밋의 성능은 따로 실측해야 한다.
무한 스크롤은 점진적 로딩이며 무제한 메모리나 성능을 보장하지 않는다. 오프라인 Git 이력 캐시는 없고 비공개
이력은 지우거나 새로고침할 때까지 메모리에서 보일 수 있다. 접속 여부와 조회량은 브라우저 네트워크 정책과
GitHub API 한도에 좌우된다.

추가 로딩은 가로로 보이는 레인의 현재 화면 하단까지를 기준으로 한다. 큰 점프 뒤에는 화면 위의 미완료 경계도
이어 읽으며, 화면 아래 경계와 최신 추적 애니메이션의 중간 위치는 조회하지 않는다. 이전 방문 범위를 누적하거나
필요한 경로를 임의로 자르지 않는다. 이미 예약된 작업은 화면 밖으로 나가도 유지하고, 대기열 정리 뒤 남은 경계를
다시 검사한다. 각 `History`의 커밋 요청은 최대 16개까지 병렬 처리한다. Split view의 저장소와 메타데이터 요청은
별도로 동작하므로 앱 전체의 HTTP 상한은 아니다. 느린 분기가 다른 빈 슬롯을 막지 않고 동일한 진행 요청은 공유한다.

빈 응답이나 요청 SHA와 맞지 않는 응답은 완료로 처리하지 않고 **Retry**를 제공한다. 오류가 나면 새 자동 요청을
멈추되 이미 시작한 독립 요청의 결과는 유지하고, 실패한 소스만 재시도한다. 저장소·방향·토큰을 바꾸면 대기 및
진행 요청을 취소한다. 이름 조회만으로 커밋을 요청하지 않고, 활동 탐색은 배치당 메타데이터 한 페이지와 독립 이력
최대 세 개를 처리하며 이미 읽은 HEAD와 공유 조상은 다시 받지 않는다. 활동 탐색 실패 시 **Retry branches**를
제공한다. 오래된 순에는 마지막 페이지 정보가 필요하며, 없으면 전체 이력을 훑는 대신 오류를 표시한다.

미조회 부모는 현재 메모리의 커밋을 기준으로 판정하며 다시 필요한 조상은 유효한 불변 페이지 캐시에서 복원한다.
날짜 필터 없는 40자 SHA 고정 첫 페이지는 해당 커밋이 있어야 캐시한다. 갱신 HEAD가 이 조건을 통과하지 못하면
이전 그래프·참조·HEAD를 유지하고 다음 갱신에서 재시도한다. 날짜 필터를 사용한 활동 조회와 오래된 순의 후속
페이지는 HEAD 포함 검증에서 제외한다.

전체 참조 갱신을 마치면 삭제된 참조에만 속한 경로를 정리한다. 남은 참조의 도달 가능한 조상과 이전 HEAD는 공유
이력과 미조회 경계 너머를 보호한다. 실제 머지 부모는 남고 squash로 통합된 뒤 불필요해진 경로는 사라진다. 선택한
기준 브랜치가 삭제돼도 캐시 이력과 안내를 유지한다. 뒤늦게 도착한 활동·추천·이름 조회 응답은 완료된 갱신 버전과
비교해 옛 이름이나 HEAD를 되살리지 않으며, 전체 참조 목록이 확인되면 이전 선택 목록의 페이지 탐색을 끝낸다.
이미 사라진 부모 경계의 응답은 그래프에 합치지 않는다. 그 요청에만 해당하는 오류는 무시하지만 인증·한도 오류는
계속 알린다. 자세한 판정은 [제품 명세의 API 및 로딩](specification.md#52-api-및-로딩)을 따른다.

## Vercel 배포

[`vercel.json`](../vercel.json)에 맞춰 Node.js **24.x**, Framework Preset **Vite**, 저장소 루트, 설치 명령
`npm ci --no-audit --no-fund`, 빌드 명령 `npm run build`, 출력 경로 `dist`를 사용한다. 백엔드·Functions·
빌드 환경변수·빌드용 GitHub 토큰은 필요하지 않다. `VITE_*` 값은 브라우저 번들에 공개되므로 PAT를 넣지 않는다.

### Git 연동

Vercel 프로젝트 `commit-trail`을 `han41858/commit-trail`과 연결하고 Production Branch는 **main**, GitHub 기본
브랜치는 **dev**로 유지한다. `vercel.json`의 `git.deploymentEnabled: true`는 Git 자동 배포를 활성화한다.
Vercel Preview도 켜 둔다(`previewDeploymentsDisabled: false`). `gitProviderOptions.createDeployments`는
GitHub 배포 기록을 제어하며 Vercel 빌드 스위치와는 다르다.

기능·수정·문서·설정 작업은 최신 `dev`에서 분기하고 `dev` 대상 PR로 먼저 반영한다. `feature/*`, 기존 `feat/*`
및 `dev`는 Preview 대상이며 `main`에 승격 PR을 머지하면 Production 빌드를 시작한다. 확인된 빌드 비대상
문서만 변경한 경우에는 아래의 문서 전용 규칙으로 빌드를 취소한다.

GitHub Actions는 검증을, Vercel Git Integration은 배포를 담당한다. Preview는 CI와 병렬로 빌드할 수 있다.
`main` PR의 필수 검사는 머지를 제어할 뿐, 머지 후 검사까지 Production 도메인 반영을 보류하려면 별도의
Vercel Deployment Checks가 필요하다.

### CI 이벤트 처리

`.github/workflows/ci.yml`은 `dev`·`main` 대상 PR의 열기·다시 열기·커밋 추가·수정과 두 브랜치의 push를
검증한다. 대상 변경뿐 아니라 제목·본문만 고쳐도 고정 이름 **Test and build**로 실행한다. 항상 러너에서 승격
경로를 검사하고 `.nvmrc`와 npm 다운로드 캐시를 사용해 Node와 의존성을 준비한 다음 `npm run format:check`를
실행한다. 문서 전용으로 확인한 경우에만 작업 내부의 앱 테스트·자동화 테스트·빌드를 생략한다. 추가 Secret은
필요하지 않다.

필수 작업 전체를 건너뛰거나 이름을 동적으로 바꾸지 않는다. 스킵된 작업의 이름 표현식이 평가되지 않은 채
기록되면 성공했던 실행을 다시 돌려도 필수 검사가 대기 상태에 남을 수 있다. PR 또는 브랜치마다 같은 동시성
그룹을 사용해 최신 실행이 이전 검증을 대체한다.

`.github/rulesets/`의 정의에서 `dev`는 최신 기준 브랜치를 요구하고 `main`은 요구하지 않지만, 어느 쪽이든
PR의 병합 결과를 검증한다. `dev` Ruleset에 PR 자체를 강제하는 규칙은 없으나 운영 절차는 PR을 거친다.
PR에서 검사한 트리가 이후 push와 같다고 단정할 수 없고 릴리즈 진입점 검사도 대상 브랜치에 따라 다르므로
push 검증을 유지한다. 저장소의 JSON을 변경해도 GitHub에서 활성화된 Ruleset은 자동으로 바뀌지 않는다.

### AI 개발과 교차 리뷰

저장소 쓰기 권한자가 열린 Issue에 실행 라벨 하나를 추가하면 기본 브랜치 `dev`에서 `AI development`가 GitHub
호스팅 Ubuntu 러너로 실행한다. 필요한 라벨은 저장소에 미리 만든다. 실행 라벨이 여러 개면 시작하지 않는다.

- `ai:develop` 또는 `ai:develop:codex`: OpenAI Codex가 개발하고 Anthropic Claude가 리뷰한다.
- `ai:develop:claude`: Anthropic Claude가 개발하고 OpenAI Codex가 리뷰한다.

한 PR로 끝낼 변경과 완료·검증 조건을 Issue에 적는다. 첫 실행은 역할과 Issue·`dev`의 기준 상태를 기록한다.
컨트롤러는 개발 모델의 편집을 검증한 뒤 `ai/issue-<number>-<developer>`에 커밋하고 `dev` 대상 Draft PR 하나를
연다. 리뷰 모델은 Git 스냅샷과 전체 diff를 읽고, 컨트롤러는 구조화한 지적 사항을 PR 댓글로 남긴다. 수정 요청은
원래 개발 모델에 돌려보내며 통과하지 못한 채 리뷰 한도 3회에 도달하거나, 같은 결함이 반복되거나, 모델이 사람의
판단을 요청하면 멈춘다. 댓글만 요청하면 리뷰할 Draft PR이 없으므로 상태 댓글의 사유를 확인하고 구체적인 편집을
새 Issue에 적는다.

리뷰가 통과하면 현재 PR HEAD의 **Test and build**를 확인한다. CI가 없거나 승인 대기 또는 실패 상태라면
`needs_human`으로 멈춘다. 저장소 정책에 따라 **Approve workflows to run**을 눌러야 할 수 있다. 같은 SHA의
교차 리뷰와 CI가 모두 통과하면 Draft를 해제하고 그 SHA로 `dev`에 스쿼시 머지를 요청한다. GitHub가 기존 브랜치
규칙을 적용하며, 성공하면 Issue에 `merged`와 머지 커밋을 기록하고 연결된 Issue가 닫힌다. 충돌·PR 또는 HEAD
변경·머지 거부는 사람의 확인이 필요하다. `main` 승격은 AI 스쿼시 머지와 별도의 수동 절차다.

#### 공유 큐와 한 Issue의 CI 후속 처리

개발·정리·머지 후속 작업은 저장소 단위의 공유 동시성 그룹(`queue: max`, `cancel-in-progress: false`)을 사용한다.
여러 작은 Issue에는 각각 실행 라벨을 붙여 큐에 넣는다. 작업은 대기한 순서대로 한 번에 하나씩 실행하며, 앞선
작업이 머지됐다면 다음 새 Issue는 그 변경을 포함한 `dev`를 사용한다. 앞선 Issue가 CI 대기로 큐를 비우면 다른
작업이 먼저 진행될 수 있다. 큐는 Issue 의존성을 해석하거나 다음 Issue를 자동으로 시작하는 기능이 아니다.

`AI development CI follow-up`은 `ai/issue-*` 브랜치에서 완료된 `CI`를 받는다. 성공한 같은 저장소의 PR 실행과
정확한 `ai/issue-<number>-(codex|claude)` 이름을 확인한 뒤, 이미 리뷰를 통과해 CI를 기다리는 **같은 Issue의 같은
HEAD**만 자동으로 이어서 처리한다. CI를 기다리는 사이 다른 머지 등으로 `dev`가 바뀌면 `needs_human`으로
멈춘다. 후속 작업에는 모델 접근 권한이 없어 새 HEAD의 브랜치 갱신이나 리뷰를 대신하지 않는다.

`AI development cleanup`은 `dev`에서 완료된 `AI development`의 중단 상태를 정리한다. 성공·스킵한 실행에는
정리 러너를 할당하지 않는다. 일반 PR과 `dev`·`main` push CI는 AI CI 후속 워크플로를 시작하지 않는다.
`workflow_run`은 트리거에서 결론을 거를 수 없으므로 관련 AI 실행에 스킵 기록은 남을 수 있다.

#### 모델과 자격 증명

**Settings → Environments → ai-development → Deployment branches and tags**에서 `ai-development` Environment를
설정하고 선택된 브랜치에 `dev` **브랜치**만 추가한다. 태그나 와일드카드는 허용하지 않는다. 개발 작업과 CI 머지
후속 작업은 이 Environment를 사용한다. 다음 세 Secret은 여기에 두고 Repository Secrets 사본을 삭제한다.

- `OPENAI_API_KEY`: [OpenAI API 키](https://platform.openai.com/api-keys)로 설정한다. Codex는 Responses API와
  기본 모델 `gpt-6.2-sol`을 사용한다. 모델 ID는 [공식 Codex 카탈로그](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json)에서 확인한다.
- `ANTHROPIC_API_KEY`: [Claude Console](https://console.anthropic.com/settings/keys)의 키로 설정한다. Claude는
  Messages API와 기본 모델 `claude-sonnet-5-5`를 사용한다. 모델 ID는 [공식 Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/model.py)에서 확인한다.
- `AI_AUTOMATION_TOKEN`: `han41858/commit-trail`로 범위를 제한한 fine-grained PAT를 사용한다. **Contents**,
  **Pull requests**, **Workflows**는 읽기/쓰기, **Actions**, **Secrets**, **Environments**는 읽기 권한을 준다.
  Workflows 쓰기는 `.github/workflows/` 커밋에 필요하고 읽기 권한은 Secret 값이 아닌 격리 메타데이터를 검사한다.
  classic PAT를 사용한다면 `workflow` 스코프도 필요하다. 짧은 만료 기간과 저장소 범위 제한을 권장한다.
  [GitHub PAT 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)를 참조한다.

**Settings → Secrets and variables → Actions → Variables**의 저장소 Actions 변수 `AI_CODEX_MODEL`과
`AI_CLAUDE_MODEL`은 기본 모델보다 우선한다. 예를 들어 Claude에 Opus를 사용하려면 `AI_CLAUDE_MODEL`을
`claude-opus-5-5`로 설정한다. 개발·리뷰 역할은 그대로이고 해당 공급자 모델만 바뀐다. 이전 ID를 지정한 변수가
있으면 갱신하거나 삭제한다. 선택한 모델은 구조화 출력과 도구 호출을 지원해야 하며 API 계정의 접근 권한도
필요하다. 사용할 수 없는 모델이면 공급자 오류를 기록하고 중단하며 다른 모델로 자동 전환하지 않는다.

기본 `GITHUB_TOKEN`은 상태·리뷰 댓글·Draft 해제에 사용한다. 브랜치·커밋·PR 게시와 스쿼시 머지에는
`AI_AUTOMATION_TOKEN`을 사용해 일반 PR 및 머지 후 CI가 시작될 수 있도록 한다. 컨트롤러는 모델 실행과 게시
변경 전에 Repository Secrets가 비어 있는지, 세 자격 증명이 `dev` 전용 Environment에 있는지, Secret을 담은
다른 Environment가 명시적인 `dev` 또는 `main` 브랜치로만 제한되는지 확인한다. 비어 있는 Preview·Production
Environment에는 브랜치 제한이 필요하지 않다. 검사는 개인 소유 저장소만 지원하며 조직 Secret 상속은 별도 검토가
필요하다. 권한 부족·안전하지 않은 정책·불완전한 메타데이터는 게시 전에 `needs_human`으로 처리한다. 워크플로
커밋 권한 오류는 필요한 Workflows 권한을 안내한다.

#### 실행 격리와 게시 전 검증

모델에는 Issue, 신뢰된 `AGENTS.md`, 제한된 Git 텍스트 스냅샷을 제공하며 도구에 셸·GitHub·공급자 자격 증명을
노출하지 않는다. 워크플로·자동화·의존성 설정·`AGENTS.md`를 포함한 일반 텍스트를 Issue 범위 안에서 편집할 수
있고 별도의 디렉터리 허용 목록은 없다. Git 내부 파일·`node_modules`·저장소 밖 경로·`.env` 비밀 파일·심볼릭
링크·비텍스트·크기 초과 파일은 제외하며 `.env.example`은 허용한다. 잠금 파일을 포함해 UTF-8 파일당 읽기·편집
한도는 1 MiB다.

공급자 응답은 SSE로 받아 하나의 결과로 조합한다. `.github/scripts/ai-development/config.mjs`의 `limits`에서
모델 API 호출은 개발 요청당 `turns` 30회, 리뷰 요청당 `reviewTurns` 45회로 제한한다. `reviewTurns`가 설정되지
않으면 리뷰에도 `turns`를 적용한다. 출력은 API 호출당 32,000토큰, 편집은 개발 결과당 80개로 제한한다. 스트림의
수신 유휴 한도는 5분, API 호출 전체 시간 한도는 30분이다. Codex의 추론 설정은 `medium`이다. 오류·조기 종료·
무응답으로 결과를 알 수 없는 스트림은 자동으로 다시 요청하지 않는다. 공급자가 토큰 사용량을 반환하면 Actions
로그에 기록한다.

컨트롤러는 수정된 `package.json`과 `package-lock.json`에서 Docker로 `npm ci --ignore-scripts --no-audit --no-fund`를
실행해 의존성을 설치하고, 두 파일의 내용으로 이미지를 캐시한다. 잠금 파일 불일치나 설치 실패는 수정 시도에
검증 결과로 돌려준다. 그다음 자격 증명과 네트워크가 없는 별도 컨테이너에서 아래의 `config.checks`를 적용한다.
문서 전용 PR CI의 생략 규칙은 이 게시 전 검증에 적용하지 않는다.

```sh
npm run format:check
npm test
node --test --test-isolation=none .github/scripts/*.test.mjs
npm run build
```

#### 중단과 수동 재개

Issue에 `ai:stop`을 붙이면 컨트롤러가 다음 상태 점검에서 멈춘다. 즉시 실행을 끊어야 하면 Actions 실행을
취소한다. 정리 워크플로는 활성 상태가 남은 중단 실행을 정리한다. 상태 댓글에는 마지막 기록 커밋·PR·Actions
실행을 남긴다. 상태 댓글의 편집은 알림을 보내지 않으므로 `needs_human`이나 `failed`로 멈출 때 별도 중단
댓글도 남긴다.

1. 중단 댓글, 상태 댓글의 상세 사유, 필요한 경우 PR 지적 사항과 Actions 로그를 확인한다. 권한·격리 설정·CI 승인
   등 보고된 원인을 먼저 해결한다. 컨트롤러 수정이 필요하면 그 변경을 먼저 `dev`에 반영한다.
2. Issue가 닫혔다면 다시 열고 `ai:stop`을 제거한다. **Actions → AI development → Run workflow**에서 **dev**를
   선택하고 기존 Issue 번호를 입력한다. 실행 라벨을 다시 붙이는 것만으로는 재개하지 않는다.
3. 자동화는 원래 역할과 작업 브랜치·PR을 재사용하며 Issue 제목·본문 및 PR·HEAD의 동시 변경이나 닫힌 PR을
   확인한다. 요청 자체를 바꾸려면 새 Issue를 사용한다. 기존 PR에 새 `dev`가 필요하면 GitHub의 update-branch
   API로 반영하고 새 HEAD의 리뷰와 CI를 다시 거친다. 새 리뷰도 총 3회 한도에 포함하며 충돌은 사람이 확인한다.

탐색 한도나 결과 형식 검증으로 중단된 리뷰는 같은 이슈 번호로 수동 재개한다. API 응답을 확인할 수 없어
직접 PR 검토를 요청하는 안내가 나오면 사람이 검토한다. 실제 호출 결과를 알 수 없는 리뷰는 자동으로 다시
요청하지 않는다. 모델 API 오류는 상태 댓글에서 단계·회차·오류 분류를 확인한다.

### 문서 전용 변경 판정

`.github/scripts/change-impact.mjs`는 CI와 Vercel이 함께 사용한다. `docs/` 아래의 일반 파일과 루트의
`README.md`, `AGENTS.md`, `LICENSE.md`만 빌드에 사용하지 않는 문서 경로로 판정한다. `docs/`에는 새 가이드·
예제·이미지도 둘 수 있지만 확장자만으로 판정하지 않으며 `docs-build/` 같은 다른 디렉터리는 포함하지 않는다.
패키지·잠금 파일, TypeScript·Vite·Vercel 설정, 워크플로·Ruleset·자동화 등 다른 경로가 함께 바뀌면 전체 검사와
빌드를 유지한다.

빌드의 진입점은 `index.html`과 `src/main.tsx`이며 TypeScript는 `src`를 검사하고 Vite는 `public`을 복사한다.
`vite.config.ts`는 PWA 매니페스트와 Service Worker를 생성한다. 앱이나 빌드가 읽는 문서·템플릿은
`src/`, `public/`, `templates/` 등 위 문서 전용 경로 밖에 둔다.

CI는 전체 이력을 가져오고 PR의 기준 SHA에서 체크아웃된 병합 결과까지, 또는 push의 `before`에서 `after`까지
비교한다. 이름 변경은 이전 경로와 새 경로를 모두 검사한다. 새 브랜치·강제 push 등으로 비교가 확실하지 않거나,
이력 누락·잘못된 이벤트·빈 비교·일반 파일이 아닌 문서·판정 오류가 있으면 전체 검증으로 처리한다. 문서 전용이어도
승격 검사와 **Test and build** 결과를 유지해야 하므로 워크플로 수준의 `paths-ignore`를 사용하지 않는다.

Vercel은 `ignoreCommand`에서 같은 스크립트를 `--vercel`로 실행한다.
[Ignored Build Step](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand)에 따라 종료 코드
0은 설치·빌드·배포 전에 취소하고, 1은 정상 진행한다. `HEAD^`가 아닌 `VERCEL_GIT_PREVIOUS_SHA`부터 비교해
마지막 문서 커밋이 앞선 앱 변경을 가리지 않도록 한다. 최초 배포·이력 부족·조상 관계 불일치·같은 SHA 재배포는
정상 빌드한다. 취소 시 현재 제공 중인 배포를 교체하거나 새 Production 릴리즈를 만들지 않는다. 실제 연동 동작은
Vercel 대시보드와 Git 배포에서 검증하며, 이 규칙은 CLI 배포 경로를 추가하지 않는다.

### 브랜치 승격

1. `dev`의 최종 개발 머지를 마친 뒤 **같은 저장소의 `dev` 자체**를 head로 하는 `main` 대상 PR을 연다. 포크의
   `dev`나 기능·복구·릴리즈 브랜치는 허용하지 않는다. `.github/scripts/check-promotion.mjs`는 의존성 설치 전에
   PR의 대상·소스 브랜치·소스 저장소를 검증한다. 이 규칙의 회귀 테스트는 자동화 테스트와 함께 실행한다.
2. 필수 CI를 통과한 PR은 **merge commit**으로 머지한다. 승격에는 squash나 rebase를 사용하지 않는다. 해당
   최종 `dev` SHA가 `main`의 조상인지 확인한다.
3. `main`에만 있는 `.github/workflows/production-release.yml`을 유지한다. `main` 전체나 `main` 기반 작업
   브랜치를 `dev`로 합치지 않고 별도 릴리즈 브랜치로 우회하지 않는다. [AGENTS.md](../AGENTS.md)의 프로젝트
   전용 브랜치 규칙을 따른다.

일반 배포 경로는 Git 연동이다. 수동 CLI 배포는 명시적인 예외이며 같은 SHA로 중복 배포하거나 커밋하지 않은
파일이 포함될 수 있다. CI에는 Vercel CLI 배포 단계나 Vercel 자격 증명을 추가하지 않는다.

### Production 릴리즈 발행과 정리

`main`에만 있는 `.github/workflows/production-release.yml`의 **Production release**가 `deployment_status`를
받아 같은 커밋의 `.github/workflows/release.yml`을 호출한다. 공유 워크플로는 수동 **Production release recovery**도
제공한다. `dev`와 그 작업 브랜치의 `release.yml`에는 배포 상태 트리거가 없으므로 Preview 이벤트로 새 스킵 실행을
만들지 않는다. 과거 실행 기록은 유지한다. 공유 워크플로와 릴리즈 로직의 변경도 `dev`를 거쳐 승격하며, CI 자동화
테스트는 진입점이 `dev`에 없고 `main`에 있어야 한다는 규칙을 검사한다.

Vercel에서 GitHub 배포 기록을 켠다(`gitProviderOptions.createDeployments: enabled`). GitHub는 배포 상태 이벤트를
받고 빌드는 여전히 Vercel Git Integration이 수행한다. Repository dispatch는 끈 상태로 둘 수 있다. 추가 Secret이나
CLI는 필요하지 않으며 게시 작업만 `contents: write`를 받는다.

워크플로는 GitHub에 저장된 Vercel 봇의 배포와 성공 상태, 팀·프로젝트 대시보드 URL, 배포 SHA가 `main`에
속하는지 검증한다. 대시보드 경로와 생성된 배포 호스트는 `TEAM` 값 `han41858` 및 정확한 프로젝트 이름
`commit-trail`과 일치해야 한다. 공개 Production 도메인도 배포 URL로 허용한다. 팀 URL을 바꿀 때는 공유 `TEAM`
설정을 갱신한다. 배포된 커밋이 아니라 보호된 기본 브랜치 `dev`에서 자동화 코드를 읽고 검증 작업이 확인한 정확한
자동화 커밋으로 게시한다.

성공한 Production의 **실제 배포 커밋**에 `rel-YYYYMMDDHHmmss` 태그와 GitHub Release를 만든다. 태그에는 확인한
배포 성공 시각을 **Asia/Seoul**로 적용하고 릴리즈 노트에는 변경 내역·커밋·Production URL·배포 링크를 포함한다.
Preview나 실패한 배포는 발행하지 않는다. 같은 커밋의 반복 이벤트·재배포는 남아 있는 릴리즈를 재사용하고, 발행 실패
후 재시도는 기존 태그를 재사용한다. 기존 태그는 옮기지 않으며 다른 커밋과 시간이 충돌하면 비어 있는 다음 초를
찾는다.

게시와 정리는 저장소 단위 `queue: max`(대기 최대 100개), `cancel-in-progress: false`로 직렬화한다. 지연 이벤트와
수동 dry run이 대기 중인 게시를 대체하지 않는다. 순서는 작업이 대기하기 시작한 시점 기준이므로 태그 시각도 비교해,
이전 배포 이벤트가 새 릴리즈를 대체하거나 이미 정리된 릴리즈를 다시 만들지 않도록 한다.

자동 발행한 Production 릴리즈 중 최신 하나만 보존한다. `rel-` 타임스탬프 태그와 본문 자동화 표시를 함께 확인하며,
이전 Git Stream 이름으로 자동 발행된 릴리즈도 관리 대상으로 본다. 오래된 게시 릴리즈만 삭제하고 수동 릴리즈·초안·
프리릴리즈와 Git 태그·커밋·배포 기록은 삭제하지 않는다.

- 게시 또는 재사용에 성공하면 이전 목록·이번 실행이 반환받은 릴리즈·다시 조회한 목록을 합친다. 같은 릴리즈 ID는
  새 목록이 우선하므로 초안·프리릴리즈·수동 릴리즈로 바뀐 항목을 보호한다. 새 목록이 비어 있거나 늦게 갱신돼도 이번
  실행에서 받은 릴리즈는 즉시 개별 재조회하지 않고 보존 후보에 남긴다.
- 이전 목록에만 있던 나머지 관리 대상은 삭제 전에 ID로 다시 조회한다. `404` 또는 수동·초안·프리릴리즈로의 변경은
  후보에서 제외하고, 다른 조회 오류나 ID·태그 불일치는 삭제 전에 정리를 중단한다. 이미 사라진 최신 릴리즈 때문에
  마지막으로 남은 실제 릴리즈를 삭제하지 않도록 한다.
- 새 릴리즈 발행에 실패하면 기존 릴리즈를 건드리지 않는다. 정리 실패는 오류로 보고하고, 같은 배포를 재시도하면
  새 태그나 릴리즈를 더 만들지 않고 정리를 이어간다. 수동 dry run에서는 삭제하지 않는다.

이벤트 누락을 확인하거나 재처리하려면 기본 브랜치 `dev`에서 **Production release recovery**의 **Run workflow**를
열고 GitHub deployment ID를 `deployment_id`에 입력한다. `dry_run` 기본값은 `true`이며 태그나 릴리즈를 변경하지
않는다. 검증을 마친 성공 Production 배포를 실제 발행할 때만 이를 끈다. Preview ID는 검증 단계에서 건너뛰며 과거
배포를 자동으로 소급 발행하지 않는다.

<a name="before-publishing"></a>

### 배포 검증과 보안 헤더

로컬에서는 개발 절의 테스트·빌드·`npm run preview -- --port 4173`으로 산출물을 확인한다. 실제 Production은
프로젝트의 공개 도메인을 익명 브라우저 세션이나 Vercel 인증 없는 HTTP 요청으로 열어 HTTP 200 응답과 로그인
리디렉션이 없음을 확인한다. JS·CSS와 공개 저장소 그래프가 동작하는지도 확인한다. 보호된 개별 배포 URL이나
인증한 요청의 성공만으로 공개 접근을 확인할 수는 없다.

`han41858/commit-trail`, `angular/angular` 같은 공개 저장소에서 실제 커밋, 브랜치 선택, 오래된 이력 로딩, 방향
전환, 커밋 링크와 `?repo=owner%2Frepo`의 새로고침을 확인한다. 좁은 화면에서는 탭과 고정 폭 세로 스크롤을,
넓은 화면에서는 콘텐츠에 맞추되 최대 50%인 그래프 열과 최대 50%인 메시지 표시를 확인한다. 비공개 저장소는 앱에
조회용 fine-grained PAT를 적용해 확인한 뒤 토큰을 제거하고 이력이 지워지는지 확인한다. 잘못된 저장소와 API
한도 메시지도 점검한다.

API 요청은 방문자 브라우저에서 나가므로 검증 환경의 `api.github.com` 외부 접속 정책은 Vercel 배포와 별개다.
단위 테스트와 모의 브라우저 검증은 실제 GitHub API나 비공개 저장소 접근을 확인한 것이 아니다. 실제 접근, 공개
도메인과 대시보드 설정, 분석 수집과 외부 미리보기는 배포 환경에서 확인한다.

해시가 있는 Vite 자산은 불변 캐시를 사용하고 HTML은 Vercel 기본 캐시 정책을 유지한다. 보안 헤더는 프레임 삽입과
민감한 기기 권한을 차단하고 MIME 스니핑과 리퍼러 전송을 막는다. CSP는 스크립트와 PWA 셸을 같은 출처로 제한하고
네트워크 연결은 같은 출처와 GitHub API `api.github.com`에만 허용해 토큰을 임의 외부 출처로 전송하는 경로를
제한한다. 쿼리 내비게이션에 catch-all rewrite는 필요하지 않다. Vercel 프로젝트의 커밋·PR 댓글 설정과
`vercel.json`의 `github.silent`로 Vercel GitHub 봇 댓글을 끈다.

## 자동 갱신과 메타데이터

**Options**에서 자동 갱신을 켜거나 끄고 주기를 선택한다. 커밋 상세에서 태그·GitHub Release·Actions를 확인한다. 그래프의 🚀는 연결된 Release가 있다는 뜻이며 최신 버전이나 배포 성공을 뜻하지 않는다. Release가 없고 태그가 있으면 🏷️를 표시한다.

초기 로딩과 완료 시각, 비인증 갱신 예외, 기존 브랜치 HEAD 이동 뒤 7초 재확인, 메타데이터 조회와 캐시는 [자동 갱신 및 메타데이터 명세](auto-refresh-and-metadata.md)를 따른다.

## 개발자 진단

개발 서버에서는 **Ctrl + Shift + D**로 진단 패널을 연다. 배포 빌드를 포함해
`/?repo=owner%2Frepository&debug=1`로 진입 버튼을 활성화할 수 있다. 웹과 설치형 PWA 모두 저장소 입력창에
`:debug`를 입력하고 Enter 또는 **Explore**를 누르면 URL·저장소·API 요청을 바꾸지 않고 패널을 연다. 패널을
닫아도 측정은 계속하며 **Disable debug**로 중지하고 기록을 지운다.

HTTP·캐시·한도, 초기/수동/자동 갱신, DAG 배치와 Canvas 그리기를 구분해 종류별 최근 20개 표본을 메모리에
유지한다. **Copy diagnostics**는 민감 정보를 제외한 JSON을 만든다. DevTools Console에서도 집계와 갱신 요약을
확인할 수 있으며 새 API 요청·외부 전송·영속 저장은 하지 않는다. 재실행 시 활성화 조건·측정 구간·Split view의
집계 범위와 해석 한계는 [개발자 디버그 모드 명세](developer-debug-mode.md)를 확인한다.

## 설치형 웹 앱(PWA)

지원 브라우저의 설치 메뉴나 iOS 홈 화면 추가로 설치한다. 앱은 `standalone`으로 실행하며 설치 배너를 표시하지 않는다. 오프라인에는 정적 앱 셸만 제공하며, GitHub API 응답·비공개 이력·PAT는 Service Worker Cache Storage에 저장하지 않는다.

**Update app**을 누르면 동의한 창만 현재 URL에서 다시 연다. 설치 조건, 캐시·보안 경계, 업데이트 복구와 미확인 실기기 항목은 [PWA 명세](pwa.md)를 따른다.
