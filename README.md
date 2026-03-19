# GCS
내가 만든 첫번째 프로젝트

## Notion -> Snippet 자동 동기화

이 프로젝트는 두 가지 방식으로 동기화합니다.

- 수동/스케줄: `scripts/sync_notion_to_snippet.mjs` (날짜 기준 DB row 동기화)
- 실시간 웹훅: `server/notion_webhook_server.mjs` (Notion 수정 이벤트 수신)

## 필수 환경변수

- `NOTION_TOKEN`: Notion Integration 토큰
- `NOTION_DATABASE_ID`: 대상 DB ID
- `SNIPPET_API_TOKEN`: Snippet API 토큰

기본값이 이미 코드에 들어있어서 로컬 테스트는 바로 가능하지만, 운영 환경에서는 Secret 사용을 권장합니다.

## 선택 환경변수

- `NOTION_DATE_PROPERTY`: 날짜 속성명 (기본: 자동 탐지)
- `NOTION_TARGET_DATE`: 수동 동기화 대상 날짜 `YYYY-MM-DD` (기본: KST 오늘)
- `SNIPPET_API_URL`: 기본 `https://api.1000.school/daily-snippets`
- `SNIPPET_API_METHOD`: 기본 `POST`

웹훅 서버용:
- `PORT`: 기본 `8787`
- `WEBHOOK_PATH`: 기본 `/notion-webhook`
- `NOTION_WEBHOOK_SECRET`: Notion 서명 검증용(선택)
- `NOTION_WEBHOOK_VERIFICATION_TOKEN`: Notion 검증 토큰(선택)

## 수동 실행

```powershell
node .\scripts\sync_notion_to_snippet.mjs
```

## 웹훅 실행

```powershell
node .\server\notion_webhook_server.mjs
```

헬스체크:
- `GET /health`

웹훅 엔드포인트:
- `POST /notion-webhook`

## Notion 웹훅 연결 순서

1. 웹훅 서버를 공개 HTTPS URL로 배포합니다. (예: Render, Railway, Fly, Cloud Run)
2. Notion Integration의 Webhook 설정에서 이벤트를 등록합니다.
   - 권장 이벤트: `page.content_updated`
3. Webhook URL에 `https://<your-domain>/notion-webhook` 입력
4. Notion DB를 Integration에 `Share`로 연결
5. Notion 페이지 수정 후 스니펫 반영 확인

## GitHub Actions (스케줄 보조)

`.github/workflows/notion-sync.yml`는 정기 실행(30분) 보조용입니다.
실시간 반영은 웹훅 서버가 담당합니다.
