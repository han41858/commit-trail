# Commit Trail 문서 안내

문서는 현재 `dev` 구현을 기준으로 관리한다. 배포 버전은 승격 시점에 따라 다를 수 있으므로 과거 검증 기록과 스크린샷은 당시 환경의 결과로 해석한다.

## 기본 안내

- [제품 명세](specification.md)는 현재 기능과 공통 제약, 제품 검증 기준을 정리한다.
- [기술 가이드](technical-guide.md)는 사용법과 [구현 구조](technical-guide.md#architecture-and-limits), 개발·운영 절차를 영어로 안내한다. [CI 이벤트](technical-guide.md#ci-event-handling), [문서 전용 변경 판정](technical-guide.md#documentation-only-change-detection), [AI 개발과 교차 리뷰](technical-guide.md#ai-development-and-cross-review), [Vercel 배포](technical-guide.md#deploy-to-vercel)를 다룬다.
- [스크린샷 안내](images/README.md)는 촬영 시점과 환경, 재현 방법을 기록한다. 실제 제품 소개와 이미지는 [프로젝트 README](../README.md)에서 확인한다.
- 개발·검증·커밋·PR·머지·배포 절차는 [개발 지침](../AGENTS.md)을 따른다.

## 기능별 상세 명세

- [경로 색상과 하이라이트](dag-hover-highlight.md): 경로 소유권, 색상 재현 조건과 강조 동작을 설명한다.
- [날짜 구분선](date-separators.md): 월·일 경계와 표시 위치를 정하는 기준을 설명한다.
- [자동 갱신·메타데이터](auto-refresh-and-metadata.md): 갱신·오류 처리와 태그·릴리즈·Actions 표시를 설명한다.
- [Split view](monitor-mode.md): 저장소 선택·정렬·공유와 분할 화면의 동작을 설명한다.
- [Owner 저장소 선택](owner-repositories.md): 공개·인증 목록 조회와 페이지 처리를 설명한다.
- [최근 저장소](recent-repositories.md): 방문 이력·브랜치 선택 기록과 PAT 변경 시 처리를 설명한다.
- [PWA](pwa.md): 설치, 앱 셸 캐시, 업데이트와 장애 복구를 설명한다.
- [개발자 진단](developer-debug-mode.md): 진단 활성화 방법과 측정 범위·해석 한계를 설명한다.

세부 규칙은 전용 명세에서 관리하고, 제품 명세는 공통 계약을 요약한다.
문서를 수정할 때는 [문서 유지보수 원칙](specification.md#11-문서-유지보수)을 따른다.
