# Commit Trail 문서 안내

문서는 현재 `dev` 구현을 기준으로 관리한다. 배포된 버전은 승격 시점에 따라 다를 수 있으며, 과거 날짜가 붙은 검증 기록·이미지는 현재 모든 환경의 동작 보장이 아니다.

`docs/`는 빌드에서 사용하지 않는 문서·예제·이미지 전용 폴더다. 이 폴더와 루트의 `README.md`·`AGENTS.md`·`LICENSE.md`만 변경되면 CI의 무거운 검사와 Vercel 배포를 생략한다. 앱·빌드에서 읽는 문서나 템플릿은 확장자와 관계없이 `src/`·`public/`·`templates/` 등 이 폴더 밖에서 관리한다. 판정과 필수 검사 유지 규칙은 [기술 가이드](technical-guide.md#documentation-only-change-detection)를 따른다.

PR 제목·본문 또는 대상 브랜치 변경에도 고정 이름의 필수 `Test and build` 검사를 실행한다. 작업 전체를 생략하거나 검사 이름을 동적으로 바꾸지 않으며, 문서만 변경된 경우에는 작업 내부의 무거운 단계만 생략한다. 이벤트와 필수 검사 정책은 [CI 이벤트 처리](technical-guide.md#ci-event-handling)를 따른다.

## 문서 역할과 상세 규칙의 위치

| 문서 | 역할 |
| --- | --- |
| [제품 명세](specification.md) | 현재 기능·공통 제약·검증 기준의 요약 |
| [경로 색상과 하이라이트](dag-hover-highlight.md) | 경로 소유권·색상·강조 범위·입력·불투명도와 그 한계 |
| [자동 갱신·메타데이터](auto-refresh-and-metadata.md) | 갱신 주기·완료·오류·캐시·태그/릴리즈·Actions 집계 |
| [Split view](monitor-mode.md) | 선택·정렬·URL·독립 열·공통 갱신·상세 팝업 |
| [최근 저장소](recent-repositories.md) | 방문 기록·직접 선택 브랜치 저장·PAT 생명주기 |
| [PWA](pwa.md) | 앱 셸 캐시·사용자 확인 업데이트·장애 복구 |
| [개발자 진단](developer-debug-mode.md) | 활성화·측정 지점·집계 범위와 해석 한계 |
| [기술 가이드](technical-guide.md) | 영어 사용법·구현 구조·운영·배포 안내 |
| [화면 자료](images/README.md) | 캡처 조건·촬영 시점·기기 검증 범위 |
| [개발 지침](../AGENTS.md) | 개발·검증·커밋·PR·머지·배포 절차 |

기능별 세부 규칙은 해당 전용 명세에서 관리하고 제품 명세에는 요약과 링크를 둔다. 기술 가이드는 같은 동작을 영어로 설명하며 별도의 정책을 정의하지 않는다. 충돌을 발견하면 구현과 명시적으로 확정된 요구를 대조해 관련 설명을 함께 고친다. 문서만으로 구현 변경을 정당화하거나 구현된 동작만으로 새 정책을 확정하지 않는다.

## 구현을 대조할 위치

| 검사 영역 | 주요 구현 | 확인할 계약 |
| --- | --- | --- |
| 경로·색상 | `src/graphPaths.ts`, `src/graphColors.ts` | 기준/기본 HEAD 보호, 통합 근거·첫 고유 커밋 시각·SHA 순서, 결정적 8색 |
| 강조·아이콘 | `src/Graph.tsx`, `src/graphCanvas.ts`, `src/graphHover.ts`, `src/graphOpacity.ts` | 입력·전환 수명은 Graph, 프레임 그리기와 실제 표시 범위는 graphCanvas, 공통 시작/종료 경계·25%·140ms, 태그/릴리즈도 노드와 같은 불투명도 |
| 레이아웃·추가 조회 | `src/model.ts`, `src/graphView.ts`, `src/history.ts`, `src/HistoryCommitPages.ts`, `src/historyTraversal.ts` | 위상 순서, 미조회 부모, 화면 위쪽 경계를 포함한 현재 하단 기준 탐색, 세션별 페이지 캐시·요청 공유·취소 수명 |
| 앱 화면 구성 | `src/main.tsx`, `src/ViewOptions.tsx`, `src/AccessTokenPanel.tsx`, `src/AppStatus.tsx`, `src/MonitorControls.tsx` | 앱 상태·인증·갱신 수명은 main, 옵션·토큰·상태·Split 제어 표시는 상태를 전달받는 컴포넌트 |
| 기준 브랜치·공유 | `src/recommendations.ts`, `src/BranchSelections.ts`, `src/repositoryLocation.ts` | 초기 선택 우선순위와 경로 소유권 우선순위의 구분, 직접 선택 저장, 반복 URL 값 |
| 갱신·Actions | `src/RefreshLoop.ts`, `src/MonitorSession.ts`, `src/CommitInfo.ts` | 성공과 완료 시각의 구분, 이번 주기에 시작한 작업만 대기, success+skipped 집계 |
| 요청 수·최근 저장소 | `src/LoadingIndicator.tsx`, `src/requestActivity.ts`, `src/RecentRepositories.ts` | 실제 진행 요청만 계수, Split 열별 범위, 최근 10개·비공개 이력 정리 |
| PWA·보안 | `vite.config.ts`, `src/PwaUpdates.ts`, `src/pwa.ts`, `vercel.json` | 정적 자산만 캐시, 확인 후 업데이트, same-origin 분석 경로와 GitHub API 허용 |
| 진단 | `src/measuredLayout.ts`, `src/debug.ts` | 화면 배치 계측과 별도 색상 정규화 계산의 구분 |

이 표는 코드 탐색을 위한 안내다. 전체 브라우저·실기기·장시간 성능이나 GitHub/Vercel 외부 설정을 검증했다는 뜻은 아니다. 관련 `*.test.ts`와 `.github/scripts/*.test.mjs`의 검증 범위 및 각 명세의 한계도 함께 확인한다.

## 갱신 원칙

- 현재 동작, 미구현 제안, 과거 검증 결과를 구분한다. 완료된 초기 작업 지시를 현재 요구사항으로 남기지 않는다.
- 수치·상태 우선순위·예외를 바꾸면 전용 명세·제품 요약·기술 가이드가 함께 맞는지 확인한다.
- 색상 재현은 같은 참조·로딩 범위·기준 HEAD·기본 브랜치 정보에서의 보장이다. rebase·시각 오류·부분 이력 변경에도 색이 고정된다는 뜻은 아니다.
- 동작을 바꾸는 새 결정과 문서 오류 수정은 구분한다. 문서 정리만으로 API·저장·배포 정책을 바꾸지 않는다.
