# Commit Trail — PWA 개발 명세서 v0.1

## 1. 목적

Commit Trail을 모바일과 데스크톱에 설치할 수 있는 Progressive Web App(PWA)으로 확장합니다.

특히 모바일에서는 브라우저 주소창 없이 전체 화면에 가까운 공간을 사용해 세로형 Git 커밋 그래프를 탐색하는 경험을 제공합니다.

기존 웹앱의 기능과 인터페이스를 유지하며, 별도의 모바일 앱이나 백엔드를 개발하지 않습니다.

### 기본 원칙

- 기존 React + TypeScript + Vite 기반 유지
- 모바일 Standalone 모드 중심
- 기존 Git DAG 및 Canvas 2D 렌더링 유지
- 공개·비공개 GitHub 저장소 지원 정책 유지
- 기존 PAT 저장 정책 변경 금지
- Vercel Preview/Production 자동 배포와 호환
- 최소한의 의존성과 코드 변경
- 불필요한 설치 유도 UI나 부가 기능 추가 금지

## 2. 설치 가능한 PWA

### 2.1 Web App Manifest

Web App Manifest를 구성합니다.

| 속성             | 설정                  |
| ---------------- | --------------------- |
| name             | Commit Trail          |
| short_name       | Commit Trail          |
| id               | `/`                   |
| start_url        | `/`                   |
| scope            | `/`                   |
| display          | `standalone`          |
| orientation      | 제한 없음             |
| theme_color      | 기존 UI 테마와 일치   |
| background_color | 기존 앱 배경색과 일치 |

- 앱 이름과 아이콘은 기존 Commit Trail 브랜드 사용
- 모바일 세로·가로 방향 모두 허용
- 홈 화면에서 실행하면 Commit Trail의 시작 화면 표시
- 특정 저장소 URL은 기존 `?repo=` 파라미터 유지. 반복 `repo`와 `mode=monitor`를 사용하는 분할 구성도 현재 URL에서 복원하며 상세 정책은 [Monitor Mode 명세](monitor-mode.md)를 따른다.
- 주소창 없는 실행에서도 저장소 입력창에 `:debug`를 입력하고 제출해 개발자 진단을 연다. 명령은 현재 저장소를 유지하며 추가 API 조회나 페이지 이동을 발생시키지 않는다. 상세 활성화·종료 정책은 [개발자 디버그 모드 명세](developer-debug-mode.md)를 따른다.
- 쿼리 파라미터에 따라 별개의 PWA로 인식되지 않도록 고정된 `id` 사용

Manifest는 Vercel의 Production과 Preview에서 올바르게 제공되어야 합니다.

### 2.2 앱 아이콘

현재 저장소에 있는 공식 Commit Trail 로고를 활용합니다.

필요한 아이콘:

- 192×192 PNG
- 512×512 PNG
- Maskable 아이콘
- Apple Touch Icon

요구사항:

- 기존 로고의 정체성 보존
- 작은 크기에서도 식별 가능
- 아이콘 중심 배치
- 불필요한 글자나 새로운 디자인 추가 금지
- Maskable 아이콘은 잘림을 고려하여 안전 영역 확보
- 로고 원본은 수정하지 않고 필요한 파생 이미지 생성

기존 아이콘 파일이 있다면 중복 생성하지 않습니다.

## 3. 모바일 Standalone UI

### 3.1 전체 화면 사용

PWA 설치 후 실행 시 `display: standalone`을 적용합니다.

- 브라우저 주소창과 브라우저 탭 UI 없이 실행
- 그래프가 사용 가능한 화면 공간을 최대한 차지하도록 구성
- 기존 상단 컨트롤과 하단 정보 표시 유지
- 작은 화면에서도 스크롤과 커밋 선택 정상 동작
- 별도 모바일 전용 화면 생성 금지

운영체제 상태 표시줄과 시스템 내비게이션 영역은 유지될 수 있습니다.

완전 몰입형 `fullscreen` 모드는 사용하지 않습니다.

### 3.2 Viewport 및 Safe Area

다음 환경을 고려합니다.

- iPhone의 노치 및 Dynamic Island
- Android 상태 표시줄
- 화면 하단 홈 인디케이터
- 가로 화면 회전
- 주소창이 없는 Standalone 레이아웃

필요한 경우 CSS의 Safe Area 환경 변수를 활용합니다.

기존 그래프에 중복된 여백이나 스크롤바가 생기지 않도록 합니다.

모바일 키보드가 표시될 때 저장소 입력창과 화면 스크롤이 정상적으로 동작해야 합니다.

### 3.3 터치 인터랙션

기존 모바일 동작을 유지합니다.

- 세로 스와이프로 Git 이력 탐색
- 커밋 Tap으로 상세 정보 확인
- 브랜치 선택 및 시간 방향 변경
- 자동 갱신 중 탐색 위치 유지
- 화면 회전 시 Canvas 크기 재계산

PWA 도입으로 브라우저의 기본 터치 동작이나 접근성을 손상시키지 않습니다.

## 4. Service Worker

### 4.1 기본 정책

Service Worker를 사용하여 앱의 정적 리소스를 캐싱합니다.

캐싱 대상:

- 빌드된 JavaScript
- CSS
- 앱 아이콘
- Manifest 관련 정적 리소스
- 앱 시작에 필요한 정적 HTML

Commit Trail은 GitHub API를 사용하므로 앱 셸과 Git 데이터의 캐싱 정책을 구분합니다.

### 4.2 캐싱 금지 대상

다음 항목은 Service Worker Cache Storage에 저장하지 않습니다.

- GitHub API 응답
- 비공개 저장소 데이터
- 커밋 및 브랜치 이력 응답
- GitHub Actions 실행 정보
- GitHub PAT 또는 인증 관련 데이터

`api.github.com`에 대한 요청은 기존 브라우저 네트워크 동작을 유지합니다.

API 응답을 가로채 영속 캐시에 저장하거나 임의로 재사용하지 않습니다.

### 4.3 오프라인 동작

이번 버전은 완전한 오프라인 Git 뷰어를 목표로 하지 않습니다.

- 정적 앱 셸은 가능한 경우 오프라인에서도 실행
- GitHub API 요청에는 네트워크 연결 필요
- 네트워크가 없을 때 기존 오류·오프라인 안내 활용
- 오프라인 상태에서 Git 데이터가 존재하는 것처럼 표시하지 않음
- 네트워크 복구 후 기존 자동 갱신 정책에 따라 조회 재개

오프라인 커밋 데이터 저장 기능은 구현하지 않습니다.

## 5. PWA 업데이트

### 5.1 배포된 새 버전 감지

Vercel에 새 버전이 배포되면 Service Worker 업데이트를 감지합니다.

단, 새 버전이 확인되었다는 이유로 현재 화면을 즉시 새로고침하지 않습니다.

Commit Trail은 자동 갱신되는 커밋 그래프를 사용자가 탐색할 수 있으므로, 앱 버전 업데이트와 GitHub 데이터 갱신을 구분해야 합니다.

### 5.2 업데이트 적용

**사용자 확인 후 새 버전을 적용하는 방식을 기본으로 합니다.**

- 새 앱 버전이 준비되면 오른쪽 아래에 간결한 업데이트 안내 표시. 기본 오른쪽·하단 여백은 12px이며 Safe Area가 더 크면 해당 값을 적용
- 안내는 테마에 맞춘 대비가 높은 배경·테두리·그림자로 그래프와 구분한다. `Update app`은 기존 노란 강조색의 채움 버튼을 사용하고, `Later`는 차분한 윤곽 버튼으로 표시한다
- 사용자가 갱신을 선택하면 새 버전 적용
- 적용 버튼은 클릭 직전 실제 너비·높이를 고정한 뒤 `Update app`을 `Updating…`로 바꿔, 문구 전환으로 버튼·인접 버튼·안내창의 크기와 위치가 바뀌지 않음. 버튼은 줄바꿈·축소와 브라우저 기본 외형의 영향을 받지 않도록 표시
- 나중에 적용할 수 있도록 닫기 제공
- 불필요하게 반복해서 안내하지 않음
- 탐색 중인 그래프를 강제로 새로고침하지 않음

UI는 기존 Commit Trail 디자인을 따릅니다.

복잡한 업데이트 관리자나 별도 설정 화면을 만들지 않습니다.

### 5.3 업데이트 안정성

- 새 Service Worker가 준비되기 전까지 기존 앱 정상 동작
- 변경된 정적 자산이 일관되게 갱신되도록 처리
- 오래된 자산 캐시 정리
- 업데이트 실패 시 기존 앱 사용 가능
- 캐시 오류로 빈 화면이 발생하지 않도록 방어

브라우저 새로고침이나 앱 재시작 시 기존 쿼리 기반 저장소 선택 동작을 유지합니다.

새 버전 적용을 위해 API 데이터를 별도로 영속 저장하지 않습니다.

## 6. 인증 및 보안

기존 GitHub PAT 정책을 변경하지 않습니다.

현재 Commit Trail은 사용자가 적용한 PAT를 `localStorage`에 저장하고 재실행 시 복원할 수 있으므로, PWA에서도 기존 정책을 그대로 유지합니다.

- Service Worker에는 PAT 전달 금지
- 인증 헤더 및 토큰 로깅 금지
- Service Worker Cache Storage에 인증 데이터 저장 금지
- GitHub API 호출은 기존 API 클라이언트가 수행
- 새로운 외부 API나 분석 서비스 추가 금지
- 기존 Content Security Policy 유지
- 필요한 경우에만 Manifest 및 Service Worker 관련 설정 조정

PWA 설치 여부가 인증 권한이나 GitHub API 호출 제한에 영향을 주지 않아야 합니다.

## 7. Vercel 배포 연동

기존 GitHub–Vercel Git Integration 배포 정책을 유지합니다.

| 브랜치                  | 배포 환경  |
| ----------------------- | ---------- |
| `feature/*`, `fix/*` 등 | Preview    |
| dev                     | Preview    |
| main                    | Production |

- 브랜치별 Preview 자동 배포 유지
- main 병합 시 Production 자동 배포 유지
- Production 성공 후 Release 자동화 유지
- Vercel CLI를 이용한 별도 중복 배포 워크플로 추가 금지
- PWA에 필요한 별도 환경 변수나 Secrets를 만들지 않음

### Preview 환경 주의사항

Preview URL과 Production URL은 서로 다른 Origin일 수 있습니다.

Service Worker, 캐시 및 PWA 설치 상태가 Origin별로 분리된다는 점을 고려합니다.

- Preview에서 PWA 설치와 업데이트 테스트 가능
- Production 설치 상태에 Preview가 영향을 주지 않음
- 배포 URL이 변경되어도 Production의 기존 PWA 식별자가 불필요하게 변경되지 않도록 유지
- 실제 공개 Production 도메인에서 설치 및 업데이트 확인

PWA 설치 후 사용하는 대표 주소는 Vercel Production의 안정적인 도메인을 기준으로 합니다.

## 8. 기술 구현

기존 Vite 프로젝트에 적합한 PWA 구성을 적용합니다.

`vite-plugin-pwa` 사용을 우선 검토하되, 실제 필요 기능과 의존성 증가를 확인한 후 도입합니다.

- Manifest 생성
- Service Worker 등록
- 정적 앱 셸 캐싱
- 업데이트 감지와 사용자 확인
- 정적 자산 갱신 및 오래된 캐시 정리

불필요하게 커스텀 Service Worker를 직접 구현하지 않습니다.

기존 React 코드와 Vite 설정 변경은 필요한 범위로 제한합니다.

## 9. 테스트

### 설치

1. Android Chrome에서 설치 가능
2. iOS Safari에서 홈 화면에 추가 가능
3. 데스크톱 Chromium 브라우저에서 설치 가능
4. 앱 이름과 아이콘 정상 표시

### 화면

5. Standalone 모드 정상 실행
6. 모바일 Safe Area와 Viewport 처리
7. 세로·가로 화면 회전
8. 저장소 입력 시 키보드 동작
9. 커밋 그래프 스크롤 및 Tap 정상 동작

### 데이터

10. 공개 저장소 조회
11. PAT 인증을 사용하는 비공개 저장소 조회
12. 자동 갱신 정상 동작
13. 네트워크 오프라인·복구 처리
14. 앱 재실행 후 기존 토큰 정책 유지

### 캐시 및 업데이트

15. 정적 자산 캐싱 확인
16. GitHub API 응답 미캐싱 확인
17. 새 버전 배포 후 업데이트 감지
18. 사용자가 갱신을 선택하기 전 강제 새로고침 없음
19. 업데이트 이후 앱 정상 실행
20. 오래된 캐시 정리
21. Preview와 Production 캐시 분리

가능한 자동 테스트를 작성하고, 실제 기기에서 확인해야 하는 항목은 별도로 정리합니다.

## 10. 제외 사항

다음 기능은 이번 작업에서 구현하지 않습니다.

- Git 데이터 오프라인 저장
- 백그라운드 GitHub API 동기화
- Push Notification
- 브라우저 알림
- 자동 설치 팝업
- 앱 내 설치 유도 배너
- 앱스토어 패키징
- 완전 몰입형 fullscreen 모드
- 사용자별 PWA 설정 동기화
- 복잡한 캐시 관리 UI
- 별도 백엔드

## 11. 완료 기준

- Commit Trail을 모바일 홈 화면에 설치 가능
- Standalone 모드에서 기존 Git 그래프 정상 동작
- 기존 공식 로고가 앱 아이콘으로 표시
- 모바일 Safe Area 및 화면 회전 지원
- 정적 앱 셸 캐싱
- GitHub API 및 PAT의 Service Worker 캐싱 없음
- 새 앱 버전 업데이트 안내 및 사용자 선택 적용
- 기존 자동 갱신·브랜치 선택·커밋 상세 동작 유지
- Vercel Preview 및 Production 호환
- 테스트·빌드 통과

---

## 12. 구현 구성

- `vite.config.ts`: `vite-plugin-pwa` 2.x의 `generateSW`, `registerType: prompt`를 사용한다. 커스텀 Service Worker와 별도 배포 워크플로는 추가하지 않는다. PWA 빌드 의존성은 `package.json`과 잠금 파일에서 관리한다.
- Manifest는 `/manifest.webmanifest`, Service Worker는 `/sw.js`에서 제공한다. ID·시작 주소·범위는 `/`로 고정하고 방향은 제한하지 않는다. 페이지의 기존 쿼리(반복 `repo`·`mode`·`debug` 포함)와 fragment는 업데이트 후에도 유지한다.
- `assets/logo.svg`와 `assets/logo-light.svg`를 어두운/밝은 테마의 정지형 원본으로 사용한다. 첫 화면의 큰 로고는 대응하는 `*-animated.svg`를 표시하고, `prefers-reduced-motion: reduce`이면 `<picture>`의 정지형 source로 전환한다. 헤더는 정지형 SVG를 사용하며 앱의 시스템/수동 테마 선택을 따른다.
- `public/icons/`의 192/512 PNG와 Apple 180 PNG는 어두운 배경(`#070a11`) 위에 `assets/logo.svg`를 렌더링한다. Maskable 512 PNG는 SVG 전체를 중앙 288px 정사각형에 넣어 반지름 40%의 안전 원 안에 보존한다. 탭 아이콘은 원본 정지형 SVG의 경로·색상을 유지하되 `viewBox`를 줄여 확대하고 궤적 두께를 보강한 `favicon.svg`를 사용한다. 어두운 브랜드 배경으로 밝은 탭에서도 대비를 확보하며, 32px PNG fallback은 같은 favicon에서 생성한다. 홈 화면·공유 이미지용 PNG는 앱 테마와 무관하게 같은 브랜드 배경을 사용한다.
- `src/PwaUpdates.ts`, `src/pwa.ts`, `src/PwaUpdatePrompt.tsx`: 등록·새 버전 안내·적용을 API 갱신과 분리한다. 최초 설치 안내나 설치 유도 배너는 없다. 같은 worker의 Later는 반복 안내하지 않으며 새 버전은 다시 알릴 수 있다.
- 배포 빌드에서만 SW를 등록한다. 기본 갱신 검사는 브라우저 등록 시, 열린 화면에서는 1시간 주기 및 온라인·탭 복귀 시 수행한다. 후자는 1분 이내 중복 검사, 숨긴 탭·오프라인·설치 중 검사를 생략한다. GitHub API를 호출하지 않는다.
- 적용 버튼을 누른 창만 새 controller가 준비된 후 새로고침한다. 다른 창에서 업데이트를 적용해도 현재 창을 강제 새로고침하지 않는다. 적용 실패·15초 이내 제어권 미전환 시 기존 화면과 오류 안내를 유지하고 재시도할 수 있다.
- Workbox는 빌드된 HTML·JS·CSS·PNG·SVG와 Manifest만 precache한다. 런타임 캐시 경로는 없다. `/` 및 쿼리를 가진 `/` 탐색만 캐시된 `index.html`로 처리하고 쿼리·저장소별 HTML 캐시를 만들지 않는다. GitHub 응답·Authorization·PAT를 SW에 전달하거나 저장하는 코드는 없다. PAT는 새 제품명에 맞춘 localStorage 키를 사용하며, 이전 제품의 데이터는 이전하지 않는다. 복원·삭제 정책은 유지한다.
- 새 worker 설치가 실패하면 기존 worker와 앱 셸을 유지한다. 활성화 때 현재 정적 자산을 보존하고 오래된 precache 항목을 정리한다. 이미 열린 다른 창의 앱 코드는 사용자 적용·재시작 전까지 유지될 수 있다.
- `index.html`의 `viewport-fit=cover`, Chromium의 `interactive-widget=resizes-content`, iOS 홈 화면 메타데이터를 사용한다. 기존 동적 theme-color는 유지한다. Safe Area를 그래프 좌우·하단과 오버레이에 적용하고 그래프 상단은 기존 toolbar 측정값만 사용하여 여백을 이중 적용하지 않는다. 좁은 화면의 입력 글자 크기는 16px로 맞춘다.
- CSP는 기존 제한에 정적 자산 접근용 `connect-src 'self'`, 명시적 `worker-src 'self'`, `manifest-src 'self'`만 추가한다. SW는 재검증하며 immutable 캐시를 쓰지 않고, 기존 해시 자산은 immutable 정책을 유지한다. Preview/Production은 같은 코드이며 SW·캐시·설치는 Origin별로 분리된다.

## 13. 검증 기록과 실기기 확인

### 검증 범위와 한계

과거 초기 구현은 로컬 Chromium의 실제 Service Worker·Cache Storage와 합성 API 응답으로 확인했다. 설치 조건·정적 캐시 경계·오프라인 셸·사용자 확인 업데이트·여러 창·실패한 설치·캐시 정리를 검증했으며, 당시 테스트 개수와 상세 결과는 Git 이력에서 확인할 수 있다. 로컬 검증은 현재 배포와 실기기 동작을 보장하지 않는다.

이전 배포에서 사용자 설치 성공 확인은 있었지만 기기·OS·브라우저와 업데이트 결과가 기록되지 않아 플랫폼별 검증 완료로 보지 않는다. 실제 Android Chrome 설치·업데이트, iOS Safari 홈 화면·상태 표시줄·키보드·회전, 데스크톱 설치 실행·업데이트는 별도로 확인해야 한다. 배포 검증은 현재 Production Origin에서 익명 접근으로 수행하며, 보호된 Preview의 인증 성공과 구분한다.

이미 로딩된 Git 데이터는 기존 정책에 따라 현재 탭 메모리에 남을 수 있다. 오프라인으로 새 저장소를 여는 경우에는 기존 오류·Retry를 사용하며, 이미 정상 로딩한 저장소의 자동 갱신은 기존 숨김·온라인 복귀 정책을 따른다. 오프라인 Git 데이터베이스나 백그라운드 동기화는 없다.

## 14. Service Worker 장애 복구·긴급 해제

### 일반 롤백

- 정상 버전으로 되돌릴 때도 **같은 Origin·같은 `/sw.js` 경로**로 정상 앱 셸과 SW를 함께 제공한다. 정적 자산·HTML·SW를 서로 다른 빌드에서 섞지 않는다.
- 기존 Vercel Git Integration의 PR·검사·브랜치 정책을 유지한다. Preview에서 복구를 확인한 뒤 승인된 Production 릴리즈/롤백 절차를 따른다. CLI 중복 배포, Secrets, 보호 설정 변경은 필요하지 않다.
- 문제가 있던 SW의 캐시가 탐색을 처리하므로, PWA 도입 이전 버전으로 서버만 되돌리거나 `/sw.js`를 삭제·404로 만드는 것만으로 이미 설치된 SW가 해제되지는 않는다.

### 긴급 해제용 빌드

기존 SW·앱 셸 자체가 잘못되어 일반 업데이트 안내로 복구할 수 없을 때 운영자가 선택하는 예외 절차다. **평상시 설정에는 활성화하지 않는다.**

1. 정상 정적 앱을 기준으로 `vite.config.ts`의 `VitePWA({ ... })`에 임시로 `selfDestroying: true`를 추가하고 기존 `npm run build`를 실행한다. `filename`/`scope`/배포 Origin은 바꾸지 않는다. 별도 환경 변수는 만들지 않는다.
2. `dist/sw.js`가 `registration.unregister()`를 포함하는 해제용 worker인지 확인한다. 평상시 precache worker와 혼동하지 않는다.
3. 독립 Origin의 Preview/로컬 환경에서 이전 PWA를 먼저 설치한 후 같은 Origin에 해제 빌드를 제공해 검증한다. 매번 달라지는 Preview 배포 URL끼리는 이 검증이 되지 않는다. 보호된 Preview는 기존 인증을 사용한다.
4. 실제 서비스 반영에는 별도 Production 승인이 필요하다. 장애 안내 후 정상 PR·릴리즈 또는 승인된 Vercel 롤백 경로로 배포한다. 이 문서 작성·검증 과정에서는 실제 Production에 배포하지 않는다.
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

### 운영상 선택과 후속 항목

- 디버그 JS·CSS도 정적 precache에 포함하므로 오프라인에서 진단 패널을 사용할 수 있다. 별도 청크이더라도 SW 설치 시 내려받는다.
- 설치 스플래시의 초기 색은 기본 어두운 브랜드 색으로 고정하고 실행 후에는 기존 시스템/앱 테마를 적용한다.
- 업데이트 안내는 오른쪽 아래에 고정한다. 디버그 진입 버튼·로딩 실패 안내가 함께 표시되면 같은 알림 영역에서 업데이트 안내의 8px 위에 쌓아, 안내 높이나 줄바꿈에 관계없이 겹치지 않게 한다. 업데이트 안내가 없을 때의 디버그 위치는 유지하며, 패널이 열려 있어도 업데이트 안내를 조작하고 닫을 수 있다.
- 기존 `assets/logo.png`·`assets/logo-320.png`는 원본 이력으로 보존하며 앱 번들과 precache에는 포함하지 않는다. 실제 캐시 크기는 빌드 산출물에 따라 달라지고 API 데이터는 포함하지 않는다.
- 의존성 감사는 현재 잠금 파일과 조회 시점의 권고를 기준으로 `npm audit` 및 `npm audit --omit=dev`로 구분해 확인한다. 과거 감사 건수를 현재 상태로 간주하지 않으며, 자동 수정이 제안돼도 사용 중인 PWA API·호환성을 확인한 뒤 적용한다.
