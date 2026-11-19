# Commit Trail — PWA 명세

## 1. 지원 범위

Commit Trail은 지원 브라우저에서 모바일·데스크톱 설치를 지원하는 Progressive Web App(PWA)이다.
웹과 설치 앱은 같은 React + TypeScript + Vite 앱, Canvas 2D 그래프, 공개·비공개 저장소 접근 정책을 사용한다.
별도 모바일 앱이나 백엔드는 사용하지 않는다.

설치는 브라우저 메뉴 또는 홈 화면 추가 기능을 사용한다. 자체 설치 팝업·설치 유도 배너·앱스토어 패키징은 제공하지 않는다.
Push Notification, 브라우저 알림, 사용자별 PWA 설정 동기화, 별도 업데이트 설정이나 캐시 관리 화면도 제공하지 않는다.

## 2. 설치 가능한 PWA

### 2.1 Web App Manifest

`vite.config.ts`는 Vercel Preview와 Production에서 사용하는 `/manifest.webmanifest`를 생성한다.

- `name`과 `short_name`은 `Commit Trail`을 사용한다. `id`, `start_url`, `scope`는 모두 `/`로 고정한다. 쿼리별로 앱을 따로 식별하지 않으며, 홈 화면에서 실행하면 `/`의 시작 화면을 연다.
- `display`는 `standalone`을 사용하며 `orientation`을 지정하지 않아 세로·가로 방향을 모두 허용한다.
- `theme_color`와 `background_color`는 어두운 브랜드 색 `#070a11`을 사용한다. 실행 후에는 앱의 시스템·수동 테마와 동적 `theme-color`를 적용한다.

저장소 링크는 `?repo=`를 사용한다. 반복 `repo`와 `mode=monitor`로 표시하는 분할 구성은 [Split view 명세](monitor-mode.md)를 따른다.
주소창 없이도 입력창의 `:debug`로 진단을 열 수 있으며, 명령의 세부 동작은 [개발자 디버그 모드 명세](developer-debug-mode.md)를 따른다.

### 2.2 앱 아이콘

`public/icons/`의 `app-logo-192.png`, `app-logo-512.png`, `apple-touch-logo-180.png`는 `assets/app-icon.svg`를 어두운 브랜드 배경 위에 렌더링한 이미지다.
홈 화면의 48~60dp 크기에서 식별할 수 있도록 파랑·바이올렛·코랄 행성 3개와 굵고 완만한 궤적을 사용한다.
진행 축은 캔버스 중심을 지나는 -32°이며, 블러 없이 그라데이션만 사용한다.
`app-logo-maskable-512.png`는 동일한 그림을 반지름 40%의 안전 원에 맞춘 `assets/app-icon-maskable.svg`에서 생성한다.
홈 화면과 공유 이미지의 배경은 앱 테마와 무관하며, 아이콘 URL이 달라져도 Manifest의 `id`는 `/`를 유지한다.
설치 아이콘의 반영 시점은 브라우저·OS에 따라 앱 셸 갱신과 다를 수 있다. iOS에서 이전 아이콘이 남으면 홈 화면에 다시 추가해 확인한다.

브라우저 탭의 `favicon.svg`는 16~32px에서 읽히도록 태양·행성 궤적·꼬리 모티브를 행성 2개와 굵은 궤적으로 단순화한다.
블러나 마스크 없이 그라데이션을 사용하며, 요소를 캔버스의 80%에 맞추고 어두운 브랜드 배경(모서리 반경 112)을 사용한다.
`favicon-32.png`는 같은 그림의 대체 이미지다.

앱 화면과 README는 같은 디자인의 `assets/logo*.svg`를 사용한다. 밝은 테마는 진한 팔레트를 사용한다.
헤더는 정지형 로고를 표시하고, 첫 화면은 궤적을 축 방향으로 이동하는 `*-animated.svg`를 표시한다.
공전 중 행성의 이동 범위까지 512 캔버스 안에 배치한다. `prefers-reduced-motion: reduce`이면 `<picture>`에서 정지형으로 전환한다.
첫 화면이 표시되는 동안 반복 재생하며, 앱에서 시간 제한을 두거나 탭 복귀 후 재생을 중단하지 않는다. 백그라운드 재생은 브라우저 정책을 따른다.

## 3. 모바일 Standalone UI

### 3.1 전체 화면 사용

`display: standalone`은 브라우저 주소창과 탭 UI 없이 같은 그래프, 상단 컨트롤과 하단 상태를 표시한다.
운영체제 상태 표시줄과 시스템 내비게이션 영역은 남을 수 있다. `fullscreen`이나 모바일 전용 화면은 사용하지 않는다.

### 3.2 Viewport 및 Safe Area

`index.html`은 `viewport-fit=cover`, Chromium의 `interactive-widget=resizes-content`, iOS 홈 화면 메타데이터를 사용한다.
iOS의 상태 표시줄 설정은 `black-translucent`를 사용한다.
노치·Dynamic Island·상태 표시줄·하단 홈 인디케이터를 고려해 그래프 좌우·하단과 오버레이에 Safe Area를 적용한다.
그래프 상단은 toolbar 측정값만 사용해 상단 여백을 이중 적용하지 않는다. 좁은 화면의 저장소 입력 글자 크기는 16px이다.
회전하면 Canvas 크기를 다시 계산한다. 모바일 키보드가 열릴 때의 입력·스크롤과 중복 여백·스크롤바 여부는 실기기에서 확인한다.

### 3.3 터치 인터랙션

설치 앱에서도 세로 스와이프로 이력을 읽고 커밋을 탭해 상세를 연다. 브랜치 선택, 시간 방향 변경과 자동 갱신 중 위치 보존은 일반 웹과 같다.
브라우저 기본 입력과 스크롤을 유지하며, 세부 입력 판정은 [경로 하이라이트 명세](dag-hover-highlight.md#입력과-수명)를 따른다.

## 4. Service Worker

### 4.1 기본 정책

`vite.config.ts`는 `vite-plugin-pwa` 2.x의 `generateSW`와 `registerType: 'prompt'`를 사용한다.
커스텀 Service Worker는 두지 않으며 의존성은 `package.json`과 잠금 파일로 관리한다.
`src/app/pwa/pwa.ts`는 배포용 빌드에서 보안 컨텍스트와 Service Worker 지원을 확인한 뒤 `/sw.js`를 등록한다.
일반 배포는 HTTPS를 사용하고 로컬 검증에는 localhost를 사용한다. Vite 개발 서버는 등록하지 않으며, 등록 실패가 일반 웹 사용을 막지 않는다.

Workbox는 빌드된 HTML·JS·CSS·PNG·SVG와 Manifest를 precache한다.
지연 로딩 청크와 디버그 JS·CSS도 포함하므로 캐시된 앱 셸에서 오프라인 진단을 열 수 있다. 캐시의 실제 크기는 빌드 산출물에 따라 달라진다.
탐색 fallback은 `/`와 쿼리가 붙은 `/`에서만 `index.html`을 제공한다. 저장소·쿼리별 HTML 캐시는 만들지 않는다.

### 4.2 캐싱 금지 대상

`runtimeCaching: []`로 런타임 캐시 경로를 두지 않는다.
GitHub API 응답, 비공개 저장소 데이터, 커밋·브랜치 이력, Actions 실행 정보, PAT·인증 데이터는 Service Worker Cache Storage에 저장하지 않는다.
`api.github.com` 요청은 기존 API 클라이언트가 브라우저 네트워크를 통해 실행한다. worker에 PAT나 `Authorization`을 전달하지 않으며 GitHub 응답을 가로채 영속 저장하거나 임의로 재사용하지 않는다.

### 4.3 오프라인 동작

앱 셸이 캐시되어 있으면 오프라인에서도 실행할 수 있지만, GitHub 조회에는 네트워크가 필요하다.
이미 읽은 이력은 현재 탭 메모리에 남을 수 있다. 오프라인에서 새 저장소를 열면 기존 오류 안내와 `Retry`를 표시하며 데이터를 불러온 것처럼 표시하지 않는다.
온라인 복귀 후에는 [자동 갱신 명세](auto-refresh-and-metadata.md)의 실행 조건에 따라 조회를 재개한다.
오프라인 Git 데이터베이스 또는 백그라운드 GitHub API 동기화는 제공하지 않는다.

## 5. PWA 업데이트

### 5.1 배포된 새 버전 감지

앱 버전 검사와 GitHub 데이터 갱신을 분리한다. 브라우저는 worker를 등록할 때 업데이트를 검사한다.
열린 앱은 1시간마다, 온라인 복귀 또는 탭 표시 상태 변경 시에도 검사를 시도한다.
최근 검사 후 1분 미만이거나 탭이 숨겨져 있거나 오프라인이거나 worker 설치 중이면 앱의 추가 검사를 건너뛴다.
이 검사로 GitHub API를 호출하지 않는다.

### 5.2 업데이트 적용

`src/app/pwa/PwaUpdates.ts`와 `src/app/pwa/PwaUpdatePrompt.tsx`는 사용자가 `Update app`을 선택한 창만 다시 로드한다.
새 버전이 준비되면 `A new version of Commit Trail is ready.`를 표시하며, 준비됐다는 이유만으로 새로고침하지 않는다.
`Later` 또는 안내 내부의 Escape로 닫으면 같은 worker를 다시 알리지 않는다. 다른 worker는 다시 알릴 수 있다.

오른쪽·하단 여백은 각각 12px과 해당 Safe Area 중 큰 값을 사용한다. 대비가 높은 배경·테두리·그림자로 그래프와 구분한다.
`Update app`은 노란 채움 버튼, `Later`는 윤곽 버튼으로 표시한다. 디버그 진입 버튼·로딩 실패 안내가 있으면 같은 알림 영역의 업데이트 안내 위에 8px 간격으로 배치한다.
업데이트 안내가 없을 때는 디버그 버튼의 기본 위치를 유지하고, 디버그 패널을 연 상태에서도 업데이트 안내를 조작할 수 있다.

클릭한 버튼의 실제 너비·높이를 적용 중에 고정하고 `Update app`을 `Updating…`로 바꾼다.
기본 버튼 외형·줄바꿈·축소에 의존하지 않아 문구 전환으로 버튼과 안내 위치가 밀리지 않는다.
적용 중에는 두 버튼을 비활성화하고, 재시도할 때는 버튼 크기를 다시 측정한다.

### 5.3 업데이트 안정성

새 worker 설치에 실패하면 기존 worker와 앱 셸을 유지한다. 활성화할 때 현재 빌드 자산을 유지하고 오래된 precache를 정리한다.
승인한 창은 새 controller가 준비되면 한 번만 새로고침한다. 다른 창에서 승인해도 현재 창을 강제로 다시 로드하지 않으며, 이 창은 적용하거나 다시 열 때까지 이전 앱 코드로 실행할 수 있다.
적용에 실패하거나 15초 안에 제어권이 전환되지 않으면 기존 화면을 유지하고 `Could not apply the update. Please try again.`을 표시해 재시도를 허용한다.

현재 URL의 쿼리(반복 `repo`·`branch`, `mode`, `debug` 등)와 fragment는 새로고침 시 유지한다. 앱 업데이트를 위해 GitHub 데이터를 별도로 영속 저장하지 않는다.
설정의 `Built at`은 실행 중인 빌드를 나타내므로 이전 앱 셸은 이전 시각을 표시한다. 같은 커밋도 다시 빌드하면 시각과 번들 해시가 달라져 업데이트 대상이 될 수 있다.

## 6. 인증 및 보안

웹과 설치 앱은 적용한 PAT를 `localStorage`의 `commit-trail.github-token`에 저장해 다시 실행할 때 복원한다.
이전 제품의 키는 읽거나 이전하지 않는다. 브라우저와 설치 앱의 저장소 공유 여부는 플랫폼에 따라 다르다.
설치 여부는 GitHub 권한과 API 호출 한도를 바꾸지 않는다.

인증 헤더와 토큰을 로그에 남기지 않는다. `vercel.json`의 CSP는 `script-src 'self'`, `worker-src 'self'`, `manifest-src 'self'`를 적용하며, `connect-src`는 동일 Origin과 `https://api.github.com`만 허용한다.
PWA는 전용 외부 API나 분석 서비스를 추가하지 않는다. 앱의 기존 Vercel Web Analytics 페이지뷰와 URL 필터는 [기술 가이드](technical-guide.md#anonymous-web-analytics)를 따른다.

## 7. Vercel 배포 연동

GitHub–Vercel Git Integration은 `feature/*`, `fix/*` 등 작업 브랜치와 `dev`를 Preview에, `main`을 Production에 배포한다.
Production 성공 후 Release 자동화와 문서 전용 변경의 배포 생략은 [기술 가이드](technical-guide.md#deploy-to-vercel)를 따른다.
PWA 전용 환경 변수·Secrets 또는 Vercel CLI를 이용한 별도 배포 워크플로는 사용하지 않는다.

`vercel.json`은 `/sw.js`에 `no-cache, no-store, must-revalidate`, `/manifest.webmanifest`에 `no-cache`를 적용한다.
`/assets/`의 해시 자산은 `public, max-age=31536000, immutable`을 사용한다.

Service Worker, Cache Storage와 설치 상태는 Origin별로 분리한다. Preview의 설치·업데이트는 별도 Origin인 Production에 영향을 주지 않는다.
일반 사용자의 설치 주소는 안정적인 공개 Production 도메인을 사용한다. 배포마다 달라지는 URL을 기존 설치의 업데이트 검증 주소로 사용하지 않는다.

## 8. 검증

- `npm test`로 업데이트 상태 전이를 검증한다. `npm run build` 후 `npm run preview -- --port 4173`으로 정적 빌드를 열어 실제 Service Worker와 Cache Storage를 검사한다.
- 정적 셸만 precache되는지, 오프라인에서 셸은 열리지만 새 GitHub 조회는 실패하는지, 온라인 복귀 후 조회와 자동 갱신이 재개되는지 확인한다. 공개·비공개 저장소 조회, 재실행 시 PAT 복원, GitHub 응답과 인증 데이터의 미캐싱을 함께 확인한다.
- 같은 Origin에서 두 빌드를 차례로 제공해 새 버전 감지, `Later`, 승인 전 유지, 승인한 창만 새로고침, 현재 URL 복원, 실패 시 재시도와 이전 셸 유지, 활성화 후 캐시 정리를 확인한다. Preview와 Production의 Origin별 격리도 확인한다.
- 의존성 감사는 현재 잠금 파일을 기준으로 `npm audit`와 `npm audit --omit=dev`를 구분해 수행한다. 자동 수정이 제안되면 사용 중인 PWA API와 호환성을 확인한 뒤 적용한다.

### 실기기 확인과 검증 한계

로컬 Chromium에서 Service Worker·Cache Storage와 합성 API 응답을 확인한 이력은 현재 배포나 실기기 검증을 대신하지 않는다.
이전 사용자 설치 성공 사례에도 기기·OS·브라우저 및 업데이트 결과가 기록되지 않아 플랫폼별 검증 완료로 간주하지 않는다.

- Android Chrome과 데스크톱 Chromium에서 설치, 앱 이름·아이콘, Standalone 실행과 실제 업데이트를 확인한다.
- iOS Safari에서 홈 화면에 추가하고 아이콘·상태 표시줄·Safe Area를 확인한다. 실제 모바일 기기에서 가로·세로 회전, 입력 중 키보드, 세로 스크롤과 커밋 탭을 확인한다.
- 현재 공개 Production Origin의 배포 검증은 익명 접근으로 수행한다. 보호된 Preview에서 인증 후 성공한 결과와 구분한다.

## 9. Service Worker 장애 복구·긴급 해제

### 일반 롤백

- 정상 버전으로 되돌릴 때도 **같은 Origin·같은 `/sw.js` 경로**로 정상 앱 셸과 SW를 함께 제공한다. 정적 자산·HTML·SW를 서로 다른 빌드에서 섞지 않는다.
- 기존 Vercel Git Integration의 PR·검사·브랜치 정책을 유지한다. Preview에서 복구를 확인한 뒤 승인된 Production 릴리즈/롤백 절차를 따른다. CLI 중복 배포, Secrets, 보호 설정 변경은 필요하지 않다.
- 문제가 있던 SW의 캐시가 탐색을 처리하므로, PWA 도입 이전 버전으로 서버만 되돌리거나 `/sw.js`를 삭제·404로 만드는 것만으로 이미 설치된 SW가 해제되지는 않는다.

### 긴급 해제용 빌드

기존 SW·앱 셸 자체가 잘못되어 일반 업데이트 안내로 복구할 수 없을 때 운영자가 선택하는 예외 절차다. **평상시 설정에는 활성화하지 않는다.**

1. 정상 정적 앱을 기준으로 `vite.config.ts`의 `VitePWA({ ... })`에 임시로 `selfDestroying: true`를 추가하고 기존 `npm run build`를 실행한다. `filename`/`scope`/배포 Origin은 바꾸지 않는다. 별도 환경 변수는 만들지 않는다.
2. `dist/sw.js`가 `registration.unregister()`를 포함하는 해제용 worker인지 확인한다. 평상시 precache worker와 혼동하지 않는다.
3. 독립 Origin의 Preview/로컬 환경에서 이전 PWA를 먼저 설치한 후 같은 Origin에 해제 빌드를 제공해 검증한다. 매번 달라지는 Preview 배포 URL끼리는 이 검증이 되지 않는다. 보호된 Preview는 기존 인증을 사용한다.
4. 실제 서비스 반영에는 별도 Production 승인이 필요하다. 장애 안내 후 정상 PR·릴리즈 또는 승인된 Vercel 롤백 경로로 배포한다. 로컬·Preview 검증만으로 Production에 반영하지 않는다.
5. 기존 클라이언트가 SW 갱신 검사를 수행하면 해제 worker가 즉시 활성화되어 등록을 해제하고 제어 중인 창을 현재 URL로 다시 이동시킨다. **이 예외 절차는 다른 열린 창도 새로고침할 수 있다.** 평상시 사용자 확인 방식과 다르므로 장애 복구 때만 사용한다.
6. 플러그인 2.0.0이 생성하는 해제 worker는 **해당 Origin의 Cache Storage 전체를 삭제**한다. Commit Trail 전용 Origin에서 사용하고, 같은 Origin을 다른 앱과 공유한다면 먼저 영향 범위를 검토한다. localStorage·PAT는 삭제하지 않는다.
7. DevTools Application → Service Workers에서 해당 scope 등록 해제를 확인하고 Cache Storage가 비었는지 확인한다. 기존 쿼리·토큰 복원·GitHub 조회를 확인한다. 다른 Origin의 Preview/Production 캐시는 영향을 받지 않아야 한다.
8. 오프라인·장기 미접속 클라이언트에는 즉시 도달하지 않는다. 필요한 복구 기간 동안 같은 `/sw.js`의 해제 응답을 유지한다. 등록 코드나 endpoint를 성급히 삭제하지 않는다. 안정화 후 정상 PWA를 복원하면 평상시 등록·사용자 확인 정책으로 돌아간다.

`selfDestroying`은 새 해제 worker를 받은 클라이언트에만 작동한다. 단순히 배포 성공 상태만 보고 모든 설치가 해제되었다고 판단하지 않는다.

### 개별 브라우저의 수동 복구

장애 영향이 있는 **Commit Trail Origin에서만** DevTools를 사용한다. 해당 scope를 unregister하고 현재 앱의 precache만 삭제한 뒤 다시 연다. 예시:

```js
const registration = await navigator.serviceWorker.getRegistration('/');
if (registration?.scope === `${location.origin}/`)
  await registration.unregister();
for (const name of await caches.keys()) {
  if (
    name.startsWith('workbox-precache-') &&
    name.endsWith(`-${location.origin}/`)
  ) {
    await caches.delete(name);
  }
}
location.reload();
```

이 절차에는 `localStorage.clear()`, 토큰 삭제, 모든 사이트 데이터 삭제를 포함하지 않는다. 정상 PWA 빌드를 다시 열면 SW가 재등록될 수 있으므로 서버에서 제공 중인 복구 빌드와 함께 확인한다.
