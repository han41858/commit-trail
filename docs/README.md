# Commit Trail 문서 안내

문서는 현재 `dev` 구현을 기준으로 관리한다. 배포된 버전은 승격 시점에 따라 다를 수 있으며, 과거 날짜가 붙은 검증 기록·이미지는 현재 모든 환경의 동작 보장이 아니다.

`docs/`는 빌드에서 사용하지 않는 문서·예제·이미지 전용 폴더다. 이 폴더와 루트의 `README.md`·`AGENTS.md`·`LICENSE.md`만 변경되면 CI의 무거운 검사와 Vercel 배포를 생략한다. 앱·빌드에서 읽는 문서나 템플릿은 확장자와 관계없이 `src/`·`public/`·`templates/` 등 이 폴더 밖에서 관리한다. 판정과 필수 검사 유지 규칙은 [문서 전용 변경 판정](technical-guide.md#문서-전용-변경-판정)를 따른다.

`AI development cleanup`은 `dev`의 AI 개발 완료 이벤트만 받고 중단된 실행을 정리한다. `AI development CI follow-up`은 `ai/issue-*` 브랜치의 CI 완료 이벤트만 받고, 성공한 동일 저장소 PR과 정확한 작업 브랜치 이름을 확인한 뒤 후속 처리한다. 일반 PR과 `dev`·`main` 푸시 CI는 두 후속 워크플로의 실행 기록을 만들지 않는다. 관련 AI 실행에서 조건에 맞지 않아 남는 스킵 기록은 있을 수 있다.

PR 제목·본문 또는 대상 브랜치 변경에도 고정 이름의 필수 `Test and build` 검사를 실행한다. 작업 전체를 생략하거나 검사 이름을 동적으로 바꾸지 않으며, 문서만 변경된 경우에는 작업 내부의 무거운 단계만 생략한다. 이벤트와 필수 검사 정책은 [CI 이벤트 처리](technical-guide.md#ci-이벤트-처리)를 따른다.

AI 개발은 저장소 쓰기 권한자가 Issue에 `ai:develop`, `ai:develop:codex` 또는 `ai:develop:claude` 중 하나를 추가하면 시작한다. 반대 모델이 Draft PR을 검토하고, 같은 개발 모델이 필요 시 수정한다. 진행 중인 자동화를 멈추려면 같은 Issue에 `ai:stop` 라벨을 추가한다. 최종 커밋의 리뷰와 필수 CI가 통과하면 PR을 `dev`에 자동 스쿼시 머지하고, 연결된 Issue가 닫힌다. 토큰 권한이나 충돌 때문에 머지할 수 없으면 Issue에 사유를 기록한다. 여러 Issue의 실행 작업은 하나의 대기열을 공유하지만 Issue 간 의존성을 처리하거나 후속 Issue를 자동으로 시작하지 않는다. 리뷰를 통과하고 CI를 기다리는 동안 성공한 CI가 도착하면 같은 Issue의 같은 HEAD에 한해 머지를 이어서 처리한다. 실행이 사람의 확인을 기다리며 멈추거나 실패하면 사유를 별도 댓글로 남긴다. CI를 기다리는 사이 `dev`가 바뀌어 멈춘 Issue는 `AI development`를 그 Issue 번호로 다시 실행하면 최신 `dev`를 작업 브랜치에 반영하고 리뷰와 CI를 다시 거친다. 모델 Secret, CI 승인 및 수동 재개 설정은 [AI 개발과 교차 리뷰](technical-guide.md#ai-개발과-교차-리뷰)를 참조한다.

기본 모델은 Codex의 `gpt-6.2-sol`과 Claude의 `claude-sonnet-5-5`다. 저장소 Actions 변수 `AI_CODEX_MODEL`·`AI_CLAUDE_MODEL`이 설정돼 있으면 그 값이 우선하므로, 이전 모델이 남아 있다면 변수를 갱신하거나 제거한다. 사용 중인 API 계정의 모델 접근 권한도 필요하다.

Claude에 Opus를 사용하려면 **Settings → Secrets and variables → Actions → Variables**에서 `AI_CLAUDE_MODEL=claude-opus-5-5`로 설정한다. 개발·리뷰 역할은 기존 실행 라벨을 따른다.

처음 시험할 때는 작은 코드 또는 문서 변경과 완료 조건을 Issue에 적는다. 댓글만 요청하면 리뷰할 Draft PR이 만들어지지 않아 개발 단계에서 멈출 수 있다. 이 경우 Issue 상태 댓글에서 중단 사유를 확인한다.

자동 편집은 저장소 전체의 일반 텍스트 파일을 대상으로 하며, 워크플로·자동화 스크립트·설정·`AGENTS.md`도 Issue 범위 안에서 수정할 수 있다. Git 내부 데이터, `node_modules`, 저장소 밖 경로와 `.env` 비밀 파일은 제외하고 `.env.example`은 허용한다. `needs_human`이면 중단 댓글과 상태 댓글의 상세 사유를 해결한 뒤 **Actions → AI development → Run workflow**에서 **dev**와 기존 Issue 번호로 재실행한다. 실행 라벨을 다시 붙이는 것만으로는 재개되지 않는다. 자동화 구현 변경이 필요한 경우 먼저 `dev`에 반영한다.

교차 리뷰가 탐색 한도에 도달했거나 반환한 결과의 형식 검증에 실패했다면 같은 방식으로 수동 재개한다. 기존 PR에서 교차 리뷰를 다시 실행하며, 현재 커밋의 리뷰와 필수 CI가 통과해야 병합한다. 리뷰 API 응답을 확인할 수 없는 경우에는 중복 호출을 막기 위해 수동 검토가 필요하다. 모델 API 오류가 발생하면 상태 댓글에서 실패한 요청의 단계·회차와 오류 분류를 확인한다. 공급자의 원문 응답은 댓글에 기록하지 않는다.

AI 자격 증명은 `dev` 브랜치만 허용한 `ai-development` Environment의 Secrets에 두고 Repository Secrets 사본은 삭제한다. 게시 전에 격리 설정을 검사하며, 미설정·권한 부족이면 `needs_human`으로 멈춘다. 게시 PAT에는 Contents·Pull requests·Workflows 쓰기와 Actions·Secrets·Environments 읽기 권한이 필요하다. 일반 텍스트 읽기·편집 한도는 파일당 1MiB이며, 수정 후 `package.json`·`package-lock.json`으로 의존성을 설치하고 오프라인 검증한다.

## 문서 역할과 상세 규칙의 위치

| 문서                                                 | 역할                                                     |
| ---------------------------------------------------- | -------------------------------------------------------- |
| [제품 명세](specification.md)                        | 현재 기능·공통 제약·검증 기준의 요약                     |
| [경로 색상과 하이라이트](dag-hover-highlight.md)     | 경로 소유권·색상·강조 범위·입력·불투명도와 그 한계       |
| [자동 갱신·메타데이터](auto-refresh-and-metadata.md) | 갱신 주기·완료·오류·캐시·태그/릴리즈·Actions 집계        |
| [날짜 구분선](date-separators.md)                    | 월·일 경계 확인·대표 앵커·Locale 표기와 Canvas 위계      |
| [Split view](monitor-mode.md)                        | 선택·정렬·URL·독립 열·공통 갱신·상세 팝업                |
| [Owner 저장소 선택](owner-repositories.md)           | 명시적 Owner 조회·공개/인증 목록 통합·페이지·메모리 캐시 |
| [최근 저장소](recent-repositories.md)                | 방문 기록·직접 선택 브랜치 저장·PAT 생명주기             |
| [PWA](pwa.md)                                        | 앱 셸 캐시·사용자 확인 업데이트·장애 복구                |
| [개발자 진단](developer-debug-mode.md)               | 활성화·측정 지점·집계 범위와 해석 한계                   |
| [기술 가이드](technical-guide.md)                    | 기본 사용법·개발 환경·자동화·배포 안내                   |
| [화면 자료](images/README.md)                        | 캡처 조건·촬영 시점·기기 검증 범위                       |
| [개발 지침](../AGENTS.md)                            | 개발·검증·커밋·PR·머지·배포 절차                         |

기능별 세부 규칙은 해당 전용 명세에서 관리하고 제품 명세에는 요약과 링크를 둔다. 기술 가이드는 기본 사용 흐름을 안내하고 상세 동작은 해당 명세로 연결하며, 별도의 제품 정책을 정의하지 않는다. 충돌을 발견하면 구현과 명시적으로 확정된 요구를 대조해 관련 설명을 함께 고친다. 문서만으로 구현 변경을 정당화하거나 구현된 동작만으로 새 정책을 확정하지 않는다.

## 구현을 대조할 위치

`src/main.tsx`는 앱 진입점과 기능 조합을 맡는다. 소스는 `app/`(앱 공통 화면·설정·PWA), `graph/`(그래프·커밋 상세), `repository/`(저장소·브랜치 선택과 이력 조회), `monitor/`(Split view), `token/`(토큰·권한), `shared/`(공통 모델·GitHub 요청·갱신·진단·UI)로 나눈다. 스타일과 테스트는 관련 코드 옆에 두며 `npm test`는 모든 하위 폴더의 `*.test.ts`를 실행한다.

| 검사 영역           | 주요 구현                                                                                                                                                  | 확인할 계약                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 경로·색상           | `src/graph/graphPaths.ts`, `src/graph/graphColors.ts`                                                                                                      | 기준/기본 HEAD 보호, 통합 근거·첫 고유 커밋 시각·SHA 순서, 결정적 8색                                                                   |
| 강조·아이콘         | `src/graph/Graph.tsx`, `src/graph/graphCanvas.ts`, `src/graph/graphHover.ts`, `src/graph/graphOpacity.ts`                                                  | 입력·전환 수명은 Graph, 프레임 그리기와 실제 표시 범위는 graphCanvas, 공통 시작/종료 경계·25%·140ms, 태그/릴리즈도 노드와 같은 불투명도 |
| 레이아웃·추가 조회  | `src/shared/model.ts`, `src/graph/graphView.ts`, `src/repository/history.ts`, `src/repository/HistoryCommitPages.ts`, `src/repository/historyTraversal.ts` | 위상 순서, 미조회 부모, 화면 위쪽 경계를 포함한 현재 하단 기준 탐색, 세션별 페이지 캐시·요청 공유·취소 수명                             |
| 앱 화면 구성        | `src/main.tsx`, `src/app/ViewOptions.tsx`, `src/token/AccessTokenPanel.tsx`, `src/app/AppStatus.tsx`, `src/monitor/MonitorControls.tsx`                    | 앱 상태·인증·갱신 수명은 main, 옵션·토큰·상태·Split 제어 표시는 상태를 전달받는 컴포넌트                                                |
| 기준 브랜치·공유    | `src/repository/recommendations.ts`, `src/repository/BranchSelections.ts`, `src/repository/repositoryLocation.ts`                                          | 초기 선택 우선순위와 경로 소유권 우선순위의 구분, 직접 선택 저장, 반복 URL 값                                                           |
| 갱신·Actions        | `src/shared/refresh/RefreshLoop.ts`, `src/monitor/MonitorSession.ts`, `src/shared/github/CommitInfo.ts`                                                    | 성공과 완료 시각의 구분, 이번 주기에 시작한 작업만 대기, success+skipped 집계                                                           |
| Owner 조회·선택     | `src/repository/OwnerRepositories.ts`, `src/repository/OwnerRepositoryPicker.tsx`, `src/repository/RepositoryInput.tsx`, `src/monitor/MonitorSetup.tsx`    | 제출 시에만 조회, 공개/인증 페이지 독립, PAT 변경 시 캐시 무효화, 일반 즉시 선택·Split 체크 후 일괄 추가                                |
| 요청 수·최근 저장소 | `src/shared/ui/LoadingIndicator.tsx`, `src/shared/github/requestActivity.ts`, `src/repository/RecentRepositories.ts`                                       | 실제 진행 요청만 계수, Split 열별 범위, 최근 10개·비공개 이력 정리                                                                      |
| PWA·보안            | `vite.config.ts`, `src/app/pwa/PwaUpdates.ts`, `src/app/pwa/pwa.ts`, `vercel.json`                                                                         | 정적 자산만 캐시, 확인 후 업데이트, same-origin 분석 경로와 GitHub API 허용                                                             |
| 진단                | `src/shared/debug/measuredLayout.ts`, `src/shared/debug/debug.ts`                                                                                          | 화면 배치 계측과 별도 색상 정규화 계산의 구분                                                                                           |

이 표는 코드 탐색을 위한 안내다. 전체 브라우저·실기기·장시간 성능이나 GitHub/Vercel 외부 설정을 검증했다는 뜻은 아니다. 관련 `*.test.ts`와 `.github/scripts/*.test.mjs`의 검증 범위 및 각 명세의 한계도 함께 확인한다.

## 갱신 원칙

- 현재 동작, 미구현 제안, 과거 검증 결과를 구분한다. 완료된 초기 작업 지시·당시 테스트 개수·성능 수치는 현재 명세에 누적하지 않고 Git 이력·관련 PR에서 확인한다. 실기기 미확인 등 현재의 검증 한계는 유지한다.
- 수치·상태 우선순위·예외를 바꾸면 전용 명세·제품 요약·기술 가이드가 함께 맞는지 확인한다.
- 색상 재현은 같은 참조·로딩 범위·기준 HEAD·기본 브랜치 정보에서의 보장이다. rebase·시각 오류·부분 이력 변경에도 색이 고정된다는 뜻은 아니다.
- 동작을 바꾸는 새 결정과 문서 오류 수정은 구분한다. 문서 정리만으로 API·저장·배포 정책을 바꾸지 않는다.
