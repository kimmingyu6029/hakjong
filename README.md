# 학종 융합 주제 추천기

Gemini를 사용해 학생부용 융합 탐구 주제를 추천하는 웹사이트입니다.  
이 프로젝트는 이제 로컬 실행뿐 아니라, 24시간 켜져 있는 외부 배포와 공개 API 사용까지 고려한 형태로 정리되어 있습니다.

## 핵심 변경점

- 웹사이트용 엔드포인트: `POST /api/recommend`
- 외부 사용자용 공개 API: `POST /api/v1/recommend`
- 배포 상태 확인용 헬스체크: `GET /health`
- API 문서 확인: `GET /api`
- 공개 API 보호용 서버 API 키 지원
- 기본 레이트 리밋 지원
- Railway 배포 설정 파일 포함

## 로컬 실행

1. `.env.example`을 참고해서 `.env` 파일을 만듭니다.
2. 최소한 아래 두 값은 꼭 넣는 것을 권장합니다.

```env
GEMINI_API_KEY=your_real_gemini_key
PUBLIC_API_KEY=your_long_random_token
```

3. 서버를 실행합니다.

```bash
npm start
```

4. 브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:3000
```

## API 구조

### 1. 웹사이트 전용 API

- 경로: `POST /api/recommend`
- 목적: 현재 웹사이트 프론트엔드가 같은 도메인에서 호출
- 특징: 크로스 오리진 브라우저 호출은 차단

### 2. 공개 API

- 경로: `POST /api/v1/recommend`
- 목적: 다른 사람, 다른 앱, 다른 서버에서도 호출 가능
- 인증: `X-API-Key` 또는 `Authorization: Bearer <token>`
- CORS: `PUBLIC_API_CORS_ORIGINS`로 제어 가능

예시:

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/recommend \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_PUBLIC_API_KEY" \
  -d '{
    "teamName": "Team One",
    "target": "students",
    "problem": "stress in study spaces",
    "technology": "AI floor-plan generation",
    "majors": ["computer science", "architecture", "psychology"]
  }'
```

## 배포 권장 방식

이 프로젝트는 Railway 배포 기준으로 맞춰 두었습니다.

이유:

- Node 서버를 그대로 장기 실행 서비스로 올리기 쉽습니다.
- 공개 URL과 HTTPS를 바로 붙일 수 있습니다.
- 웹사이트와 API를 같은 서비스로 운영하기 쉽습니다.
- `railway.toml`로 시작 명령과 헬스체크를 코드에 같이 관리할 수 있습니다.

## Railway 배포 순서

1. Railway에 새 프로젝트를 만듭니다.
2. 이 프로젝트 폴더를 GitHub에 올리거나, Railway CLI로 업로드합니다.
3. 서비스의 Public Networking에서 도메인을 생성합니다.
4. 환경변수를 등록합니다.

필수 환경변수:

- `GEMINI_API_KEY`
- `PUBLIC_API_KEY`

권장 환경변수:

- `PUBLIC_API_CORS_ORIGINS`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX_REQUESTS`

5. 첫 배포 후 아래 경로가 열리는지 확인합니다.

- `/health`
- `/api`
- `/api/v1/recommend`

## 보안 메모

- `GEMINI_API_KEY`는 절대 프론트엔드 코드에 넣으면 안 됩니다.
- 외부 사용자에게는 Gemini 키가 아니라 `PUBLIC_API_KEY`만 공유해야 합니다.
- `.env.example`에는 실제 키를 넣지 마세요.
- 만약 예전에 실제 Gemini 키를 예시 파일이나 저장소에 넣은 적이 있다면, 바로 키를 폐기하고 새 키로 교체하는 것이 안전합니다.

## 테스트

```bash
npm test
```
