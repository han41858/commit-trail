# README 스크린샷 안내

## Commit Trail 촬영 정보 (2026-11-19, Asia/Seoul)

촬영에는 `dev` 커밋 `ec7539b5197a7d5f561eca9411501366b7f5d482`의 로컬 Production 빌드와 Chromium을 사용했다.
당시 앱 소스·자산·공개 파일은 배포된 `main` 커밋 `ddc221dc35eff026c645ec3664abbba4963f978f`와 일치했다.
촬영 환경의 네트워크 정책으로 Production 도메인에 접근할 수 없어 같은 앱 코드를 로컬 브라우저에서 촬영했다.

- 데스크톱과 단일 저장소 모바일 화면은 공개 저장소 [`han41858/commit-trail`](https://github.com/han41858/commit-trail)을 표시한다.
  커밋을 선택하거나 상세 패널을 열지 않아 그래프를 가리지 않으며, 촬영 당시 로고와 브랜치 레이블, 로캘에 맞는 날짜 구분선을 포함한다.
- Split view는 왼쪽부터 [`han41858/commit-trail`](https://github.com/han41858/commit-trail),
  [`han41858/ai-native`](https://github.com/han41858/ai-native), [`angular/angular`](https://github.com/angular/angular),
  [`microsoft/vscode`](https://github.com/microsoft/vscode) 순서로 공개 저장소를 표시한다.
  컨트롤은 왼쪽 가장자리의 책갈피 `>` 탭 뒤에 접어 둔다.
- 촬영 당시 브라우저 API 요청은 환경에서 인증된 GitHub CLI를 통해 `api.github.com`으로 전달했다.
  저장소 메타데이터가 공개 저장소임을 확인하고, 응답 본문을 변경하지 않은 채 촬영 세션 안에서 재사용했다.
  녹화한 갱신에서는 새 응답을 받았다. 커밋·브랜치·워크플로 상태를 합성하거나 UI 합성·이미지 오버레이·사용자 CSS를 사용하지 않았다.
  앱에는 토큰을 입력하거나 저장하지 않았다.
- 브라우저는 다크 테마, `en-US` 로캘, `Asia/Seoul` 시간대를 사용한다.
  모바일은 기기 배율 1에서 Chromium의 터치·뷰포트 에뮬레이션을 사용한다.
  실기기나 OS 수준의 설치형 PWA가 아니라 브라우저에서 앱의 뷰포트를 촬영했다.
  Split view 모바일 화면은 같은 세션과 저장소 순서를 유지한 채 추가 GitHub 요청 없이 세로에서 가로로 전환했다.

## 파일별 뷰포트와 내용

- `desktop.png` (1280 × 800): 선택 없이 현재 참조·메타데이터 아이콘·날짜 구분선을 포함한 Commit Trail 그래프를 보여 준다.
- `mobile.png` (390 × 844): 같은 저장소의 좁은 레이아웃을 상세 패널 없이 보여 준다.
- `split-desktop.png` (1600 × 900): 독립 그래프 4개와 메시지·참조·Actions 링·책갈피 탭을 보여 준다.
- `split-mobile-portrait.png` (390 × 844): 같은 저장소 4개를 DAG 중심의 좁은 열에 표시한다.
- `split-mobile-landscape.png` (844 × 390): 같은 화면을 가로로 전환한 뒤 열 너비와 레인 간격이 허용하는 곳에 메시지를 표시한다.
- `auto-refresh.gif` (900 × 380): 8 fps로 촬영한 144프레임으로 18초를 보여 준다.

스크린샷에는 촬영 시 로딩한 이력만 포함하며, 각 저장소의 전체 DAG를 보여 주지는 않는다.
메시지 표시 여부는 각 열의 너비와 실제 레인 간격에 따라 달라진다. 메시지가 숨겨져도 노드를 선택하면 전체 상세 내용을 확인한다.
단일 저장소 모바일 이미지는 참고용으로 보관하고, [README](../../README.md)에는 세로·가로 Split view 비교를 넣는다.

## 자동 갱신 녹화

GIF는 파란색 진행 표시와 기본 1분 간격의 예약된 저장소 확인을 보여 준다.
카운트다운이 끝나기 직전부터 자동 확인 후 카운트다운이 초기화될 때까지 녹화했다.
녹화 구간에서 앱은 API 요청을 다섯 건 수행했다. 브라우저 시계·CSS 애니메이션 시간·앱의 갱신 정책은 변경하지 않았다.
촬영용 새 커밋을 만들지 않았으므로 노드 추가가 아니라 예정된 확인 동작을 보여 준다.

## 촬영 재현 방법

공개 저장소와 새 브라우저 프로필을 사용하고, 앱에는 토큰을 입력하거나 저장하지 않는다.
공개할 화면이나 녹화에 토큰·인증 헤더·비공개 저장소 또는 브랜치 이름 등 민감한 정보가 노출되지 않는지 확인한다.
같은 환경을 사용해도 이후 GitHub의 참조와 이력이 달라지면 그래프는 달라질 수 있다.

1. 촬영 당시 코드로 재현할 때는 위의 대상 커밋을 사용한다. 저장소 루트에서 Node.js 24.x로 `npm ci`, `npm run build`, `npm run preview`를 차례로 실행한다.
2. 새 브라우저 프로필에서 앱을 열고 다크 테마를 사용하며 `han41858/commit-trail`을 입력한다.
   같은 레이블 표시 형식을 재현하도록 `en-US` 로캘과 `Asia/Seoul` 시간대를 사용한다.
3. 파일별로 지정한 뷰포트 크기를 설정하고 커밋을 선택하지 않은 채 포인터를 그래프 밖으로 옮긴다.
   이력과 메타데이터 요청이 끝나면 PNG를 저장한다.
4. Split view는 `/?repo=han41858/commit-trail&repo=han41858/ai-native&repo=angular/angular&repo=microsoft/vscode`로 연다.
   네 열의 이력과 메타데이터 요청이 끝날 때까지 기다린 뒤 책갈피 컨트롤을 접어 둔다.
   데스크톱과 모바일 세로 화면을 촬영한 뒤, 모바일 세션에서 저장소 순서나 스크롤 위치를 바꾸지 않고 가로 크기로 전환해 촬영한다.
5. `>` 탭과 **Manage repositories**를 사용해 현재 선택과 **Apply changes**를 확인한다. 전체 화면을 촬영하기 전에 대화상자를 닫는다.
6. GIF는 Options에서 1분 갱신 간격을 선택하고 메뉴를 닫은 뒤, 카운트다운 시작 약 48초 후부터 다음 자동 확인까지 8 fps로 녹화한다.
   수정하지 않은 프레임을 반복 재생하는 GIF로 인코딩한다.

Save the browser’s output without altering the UI or data. Live repository contents and workflow states can change, so later captures need not have the same commit count or timestamps.
