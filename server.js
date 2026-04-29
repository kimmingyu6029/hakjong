const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL_NAMES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest"
];
const GEMINI_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_BASE_DELAY_MS = 400;
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const PUBLIC_API_PATH = "/api/v1/recommend";
const APP_API_PATH = "/api/recommend";
const API_DOCS_PATH = "/api";
const HEALTH_PATH = "/health";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

const rateLimitStore = new Map();

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response, statusCode, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end();
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  });
}

function loadEnvFile() {
  applyEnvFile(path.join(ROOT, ".env"));
}

function readIntegerEnv(name, fallback, { minimum = 0 } = {}) {
  const raw = process.env[name];

  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function readHost() {
  const host = process.env.HOST;
  return typeof host === "string" && host.trim() ? host.trim() : DEFAULT_HOST;
}

function readPort() {
  return readIntegerEnv("PORT", DEFAULT_PORT, { minimum: 0 });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request body too large"));
      }
    });

    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

function sanitizeStaticPathname(pathname) {
  const decoded = decodeURIComponent(pathname).replace(/\\/g, "/");
  const safePath = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.posix.normalize(safePath);
  const relativePath = normalized.replace(/^\/+/, "");
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.some((segment) => segment.startsWith("."))) {
    return null;
  }

  const filePath = path.join(PUBLIC_DIR, relativePath);
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

function normalizeOptionalString(value, fieldName, { maxLength }) {
  if (value == null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new HttpError(422, `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new HttpError(422, `${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
}

function normalizeRequiredString(value, fieldName, { maxLength }) {
  const normalized = normalizeOptionalString(value, fieldName, { maxLength });

  if (!normalized) {
    throw new HttpError(422, `${fieldName} is required.`);
  }

  return normalized;
}

function validateRecommendationInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(422, "Request body must be a JSON object.");
  }

  if (!Array.isArray(body.majors)) {
    throw new HttpError(422, "majors must be an array.");
  }

  const majors = body.majors
    .map((major) => normalizeRequiredString(major, "Each major", { maxLength: 60 }))
    .filter(Boolean);

  if (majors.length === 0) {
    throw new HttpError(422, "At least one major is required.");
  }

  if (majors.length > 6) {
    throw new HttpError(422, "You can send up to 6 majors.");
  }

  return {
    teamName: normalizeOptionalString(body.teamName, "teamName", { maxLength: 80 }),
    target: normalizeRequiredString(body.target, "target", { maxLength: 120 }),
    problem: normalizeRequiredString(body.problem, "problem", { maxLength: 160 }),
    technology: normalizeRequiredString(body.technology, "technology", { maxLength: 160 }),
    majors
  };
}

function joinKoreanList(items) {
  const cleanItems = items.filter(Boolean);

  if (cleanItems.length === 0) {
    return "";
  }

  if (cleanItems.length === 1) {
    return cleanItems[0];
  }

  return `${cleanItems.slice(0, -1).join(", ")}와 ${cleanItems.at(-1)}`;
}

function buildFallbackRecommendation(data) {
  const teamName = data.teamName || "프로젝트 팀";
  const target = data.target || "학교 구성원";
  const problem = data.problem || "생활 속 불편";
  const technology = data.technology || "AI와 데이터 분석";
  const majors = joinKoreanList(data.majors || []) || "여러 전공";

  return {
    topicTitle: `${target}의 ${problem} 개선을 위한 ${technology} 기반 ${majors} 융합 연구`,
    topicSummary: `${teamName}은 ${target}이 겪는 ${problem}을 줄이기 위해 ${technology}를 활용하고, ${majors} 관점을 연결해 학교 현장에서 적용 가능한 결과물을 설계한다.`,
    recordText: `${teamName}은 ${majors}의 관점을 바탕으로 ${target}의 ${problem} 문제를 정의하고, ${technology}를 활용한 해결 방안을 탐구하였다. 자료 수집, 분석 기준 설정, prototype 구상 과정을 통해 실제 학교 환경에 적용 가능한 융합형 연구 주제를 도출하였다.`,
    questions: [
      `${target}은 어떤 상황에서 ${problem}을 가장 크게 경험하는가?`,
      `${majors}의 관점을 함께 적용하면 기존 해결 방식보다 어떤 장점을 만들 수 있는가?`,
      `${technology}를 활용해 수집하거나 분석해야 할 핵심 데이터는 무엇인가?`,
      `제안한 결과물이 ${target}의 만족도, 편의성, 효율성 중 어떤 지표를 개선하는지 어떻게 확인할 수 있는가?`
    ],
    activities: [
      `${target}을 대상으로 설문, 인터뷰, 관찰을 진행해 ${problem}의 원인과 빈도를 정리하기`,
      `${majors}별 역할을 나누어 문제 원인, 설계 기준, 평가 지표를 함께 정의하기`,
      `${technology}를 활용한 prototype, 분석표, 추천 기준, 또는 시각화 자료 중 하나를 제작하기`,
      `완성된 결과물을 사례에 적용해 개선 효과와 한계를 정리하고 발표 자료로 구성하기`
    ],
    aiPrompt: [
      "다음 조건을 바탕으로 고등학생 생활기록부에 활용할 수 있는 융합 탐구 프로젝트를 구체화해줘.",
      `팀명: ${teamName}`,
      `대상: ${target}`,
      `해결할 문제: ${problem}`,
      `사용 기술/방법: ${technology}`,
      `희망 전공: ${(data.majors || []).join(", ")}`,
      "요구사항: 연구 주제 3개, 탐구 필요성, 활동 단계, 결과물 예시, 생활기록부 문장 예시를 포함해줘."
    ].join("\n")
  };
}

function buildPrompt(data) {
  const majors = Array.isArray(data.majors) ? data.majors.filter(Boolean) : [];
  const target = data.target || "general users";
  const problem = data.problem || "a real-life problem or inconvenience";
  const technology = data.technology || "AI and data analysis";

  return [
    "You are an expert at designing interdisciplinary high-school research projects for student records.",
    "Your main job is to turn the user's exact inputs into one narrow, named research topic.",
    "Consider multiple intended majors together and recommend one practical, strong, portfolio-friendly research activity.",
    "Return the final answer in Korean.",
    "Return only valid JSON with no markdown code fences.",
    "JSON schema:",
    "{",
    '  "topicTitle": "string",',
    '  "topicSummary": "string",',
    '  "recordText": "string",',
    '  "questions": ["string", "string", "string", "string"],',
    '  "activities": ["string", "string", "string", "string"],',
    '  "aiPrompt": "string"',
    "}",
    "",
    "Input:",
    `Team name: ${data.teamName || "Our Team"}`,
    `Target users or audience: ${target}`,
    `Problem to solve: ${problem}`,
    `Technology or method: ${technology}`,
    `Intended majors: ${majors.join(", ") || "none provided"}`,
    "",
    "Requirements:",
    "1. topicTitle must combine the user's target, problem, technology or method, and a concrete expected output or measurement.",
    "2. topicTitle must not be a broad field, slogan, or category. Avoid titles like \"AI-based education research\", \"environmental problem solving\", \"student stress improvement\", or \"interdisciplinary project\".",
    "3. If the input is vague, narrow it to a school-scale context by choosing a specific user group, place or situation, measurable variable, and prototype format.",
    "4. topicTitle should be concrete enough that a student can start planning activities from the title alone.",
    "5. topicSummary should be one clear sentence that states who it is for, what problem is addressed, what method is used, and what output will be produced.",
    "6. recordText should read naturally like a school activity or portfolio sentence.",
    "7. questions and activities must each contain exactly 4 items.",
    "8. aiPrompt should be a detailed follow-up prompt another AI can expand.",
    "9. Show a clear connection between the majors and suggest a realistic output or prototype.",
    "10. If the majors include computer science, architecture, and psychology, prioritize an AI-based space or floor-plan generation project that improves users' psychological comfort.",
    "",
    "Specificity checklist before answering:",
    `- Audience/context used: ${target}`,
    `- Problem used: ${problem}`,
    `- Technology/method used: ${technology}`,
    `- Major perspectives used: ${majors.join(", ") || "none provided"}`,
    "- The topic names a tangible output such as a prototype, model, survey tool, dashboard, design guide, experiment, or dataset.",
    "- The topic includes a measurable outcome such as stress, satisfaction, waiting time, accuracy, accessibility, comfort, safety, or efficiency."
  ].join("\n");
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableGeminiStatus(status) {
  return GEMINI_RETRYABLE_STATUS_CODES.has(status);
}

function getGeminiRetryDelayMs(attempt) {
  return GEMINI_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
}

function formatGeminiError(status, errorText) {
  let message = typeof errorText === "string" && errorText.trim()
    ? errorText.trim()
    : "Request failed without details";

  try {
    const parsed = JSON.parse(errorText);
    const apiMessage = parsed?.error?.message;

    if (typeof apiMessage === "string" && apiMessage.trim()) {
      message = apiMessage.trim();
    }
  } catch {
    // Keep the raw body when Gemini does not return JSON.
  }

  return `Gemini API error (${status}): ${message}`;
}

function getGeminiModelNames() {
  const raw = process.env.GEMINI_MODELS || process.env.GEMINI_MODEL;

  if (typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_GEMINI_MODEL_NAMES;
  }

  const modelNames = raw
    .split(",")
    .map((modelName) => modelName.trim())
    .filter(Boolean);

  return modelNames.length > 0 ? modelNames : DEFAULT_GEMINI_MODEL_NAMES;
}

function buildGeminiApiUrl(modelName) {
  const normalizedModelName = modelName.replace(/^models\//, "");
  return `${GEMINI_API_BASE_URL}/${normalizedModelName}:generateContent`;
}

async function createRecommendation(
  data,
  {
    fetchImpl = fetch,
    waitImpl = wait,
    maxAttempts = GEMINI_MAX_ATTEMPTS,
    modelNames = getGeminiModelNames()
  } = {}
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const prompt = buildPrompt(data);
  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.35,
      topP: 0.8,
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          topicTitle: { type: "string" },
          topicSummary: { type: "string" },
          recordText: { type: "string" },
          questions: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4
          },
          activities: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4
          },
          aiPrompt: { type: "string" }
        },
        required: ["topicTitle", "topicSummary", "recordText", "questions", "activities", "aiPrompt"]
      }
    }
  });

  for (let modelIndex = 0; modelIndex < modelNames.length; modelIndex += 1) {
    const modelName = modelNames[modelIndex];
    const hasNextModel = modelIndex < modelNames.length - 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;

      try {
        response = await fetchImpl(buildGeminiApiUrl(modelName), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY
          },
          body: requestBody
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await waitImpl(getGeminiRetryDelayMs(attempt));
          continue;
        }

        if (hasNextModel) {
          break;
        }

        throw error;
      }

      if (!response.ok) {
        const errorText = await response.text();
        const geminiError = new Error(formatGeminiError(response.status, errorText));
        geminiError.geminiStatus = response.status;
        geminiError.geminiModel = modelName;

        if (isRetryableGeminiStatus(response.status) && attempt < maxAttempts) {
          await waitImpl(getGeminiRetryDelayMs(attempt));
          continue;
        }

        if (isRetryableGeminiStatus(response.status) && hasNextModel) {
          break;
        }

        throw geminiError;
      }

      const result = await response.json();
      const content = result.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;

      if (!content) {
        if (result.promptFeedback?.blockReason) {
          throw new Error(`Gemini blocked the prompt: ${result.promptFeedback.blockReason}`);
        }

        throw new Error("Gemini API returned an empty response");
      }

      const parsed = JSON.parse(content);

      if (
        !parsed.topicTitle ||
        !parsed.topicSummary ||
        !parsed.recordText ||
        !Array.isArray(parsed.questions) ||
        !Array.isArray(parsed.activities) ||
        !parsed.aiPrompt
      ) {
        throw new Error("Gemini API response did not match the expected format");
      }

      return parsed;
    }
  }

  throw new Error("Gemini API request failed after retries");
}

function shouldUseFallbackRecommendation(error) {
  if (!error || error.message?.includes("GEMINI_API_KEY")) {
    return false;
  }

  if (Number.isInteger(error.geminiStatus)) {
    return isRetryableGeminiStatus(error.geminiStatus);
  }

  return true;
}

function getRequestBaseUrl(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = typeof forwardedProto === "string" && forwardedProto.trim()
    ? forwardedProto.split(",")[0].trim()
    : (request.socket.encrypted ? "https" : "http");
  const host = request.headers.host || `localhost:${readPort()}`;
  return `${protocol}://${host}`;
}

function isSameOriginRequest(request) {
  const origin = request.headers.origin;

  if (typeof origin !== "string" || !origin.trim()) {
    return true;
  }

  return origin === getRequestBaseUrl(request);
}

function parseAllowedOrigins(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim() || rawValue.trim() === "*") {
    return null;
  }

  return new Set(
    rawValue
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function getPublicCorsHeaders(request) {
  const allowedOrigins = parseAllowedOrigins(process.env.PUBLIC_API_CORS_ORIGINS || "*");
  const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";

  if (!allowedOrigins) {
    return {
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
      "Access-Control-Allow-Methods": "GET, OPTIONS, POST",
      "Access-Control-Allow-Origin": "*"
    };
  }

  if (!requestOrigin) {
    return {
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
      "Access-Control-Allow-Methods": "GET, OPTIONS, POST"
    };
  }

  if (!allowedOrigins.has(requestOrigin)) {
    return null;
  }

  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
    "Access-Control-Allow-Methods": "GET, OPTIONS, POST",
    "Access-Control-Allow-Origin": requestOrigin,
    Vary: "Origin"
  };
}

function readApiKeyFromHeaders(headers) {
  const headerApiKey = headers["x-api-key"];

  if (typeof headerApiKey === "string" && headerApiKey.trim()) {
    return headerApiKey.trim();
  }

  const authorization = headers.authorization;

  if (typeof authorization !== "string" || !authorization.trim()) {
    return "";
  }

  const [scheme, value] = authorization.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return "";
  }

  return value.trim();
}

function authenticatePublicApiRequest(request) {
  const configuredApiKey = process.env.PUBLIC_API_KEY;

  if (typeof configuredApiKey !== "string" || !configuredApiKey.trim()) {
    return {
      ok: false,
      message: "PUBLIC_API_KEY is not configured on the server",
      statusCode: 503
    };
  }

  const providedApiKey = readApiKeyFromHeaders(request.headers);

  if (!providedApiKey) {
    return {
      ok: false,
      message: "Missing API key. Send X-API-Key or Authorization: Bearer <token>.",
      statusCode: 401
    };
  }

  if (providedApiKey !== configuredApiKey.trim()) {
    return {
      ok: false,
      message: "Invalid API key.",
      statusCode: 401
    };
  }

  return { ok: true };
}

function getClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.socket?.remoteAddress || "unknown";
}

function getRateLimitWindowMs() {
  return readIntegerEnv("API_RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, { minimum: 1 });
}

function getRateLimitMaxRequests() {
  return readIntegerEnv("API_RATE_LIMIT_MAX_REQUESTS", DEFAULT_RATE_LIMIT_MAX_REQUESTS, { minimum: 1 });
}

function applyRateLimit(scope, request) {
  const now = Date.now();
  const key = `${scope}:${getClientIp(request)}`;
  const windowMs = getRateLimitWindowMs();
  const maxRequests = getRateLimitMaxRequests();
  const currentEntry = rateLimitStore.get(key);

  if (!currentEntry || currentEntry.resetAt <= now) {
    const freshEntry = {
      count: 1,
      resetAt: now + windowMs
    };

    rateLimitStore.set(key, freshEntry);

    return {
      allowed: true,
      limit: maxRequests,
      remaining: Math.max(maxRequests - freshEntry.count, 0),
      resetAt: freshEntry.resetAt
    };
  }

  currentEntry.count += 1;
  rateLimitStore.set(key, currentEntry);

  return {
    allowed: currentEntry.count <= maxRequests,
    limit: maxRequests,
    remaining: Math.max(maxRequests - currentEntry.count, 0),
    resetAt: currentEntry.resetAt
  };
}

function buildRateLimitHeaders(rateLimitResult) {
  return {
    "X-RateLimit-Limit": String(rateLimitResult.limit),
    "X-RateLimit-Remaining": String(rateLimitResult.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimitResult.resetAt / 1000))
  };
}

function buildApiDocs(request) {
  const baseUrl = getRequestBaseUrl(request);

  return {
    name: "hakjong-topic-recommender",
    version: "1.1.0",
    baseUrl,
    endpoints: {
      health: {
        method: "GET",
        path: HEALTH_PATH
      },
      docs: {
        method: "GET",
        path: API_DOCS_PATH
      },
      website: {
        method: "POST",
        path: APP_API_PATH,
        auth: "Same-origin web app requests"
      },
      publicApi: {
        method: "POST",
        path: PUBLIC_API_PATH,
        auth: "X-API-Key or Authorization: Bearer <token>"
      }
    },
    exampleHeaders: {
      "Content-Type": "application/json",
      "X-API-Key": "YOUR_PUBLIC_API_KEY"
    },
    exampleBody: {
      teamName: "Team One",
      target: "students who need a calmer study space",
      problem: "stress in study rooms",
      technology: "AI floor-plan generation",
      majors: ["computer science", "architecture", "psychology"]
    },
    curlExample: `curl -X POST ${baseUrl}${PUBLIC_API_PATH} -H "Content-Type: application/json" -H "X-API-Key: YOUR_PUBLIC_API_KEY" -d "{\\"teamName\\":\\"Team One\\",\\"target\\":\\"students\\",\\"problem\\":\\"stress in study spaces\\",\\"technology\\":\\"AI floor-plan generation\\",\\"majors\\":[\\"computer science\\",\\"architecture\\",\\"psychology\\"]}"`,
    notes: [
      "Set GEMINI_API_KEY on the server.",
      "Set PUBLIC_API_KEY before exposing the public API.",
      "Use PUBLIC_API_CORS_ORIGINS to restrict which browser origins can call the public API.",
      "Adjust API_RATE_LIMIT_WINDOW_MS and API_RATE_LIMIT_MAX_REQUESTS if you need different throttling."
    ]
  };
}

function serveStatic(request, response) {
  const host = request.headers.host || `localhost:${readPort()}`;
  const pathname = new URL(request.url, `http://${host}`).pathname;
  const filePath = sanitizeStaticPathname(pathname);

  if (!filePath) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      sendJson(response, 500, { error: "Failed to read file" });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  });
}

async function handleRecommendationRequest(request, response, options = {}) {
  const rateLimitResult = applyRateLimit(options.rateLimitScope, request);
  const headers = {
    ...buildRateLimitHeaders(rateLimitResult),
    ...(options.corsHeaders || {})
  };

  if (!rateLimitResult.allowed) {
    sendJson(response, 429, {
      error: "Too many requests. Please try again later."
    }, headers);
    return;
  }

  if (options.requireSameOrigin && !isSameOriginRequest(request)) {
    sendJson(response, 403, {
      error: "Cross-origin browser access is not allowed on this endpoint. Use /api/v1/recommend with an API key."
    }, headers);
    return;
  }

  if (options.requirePublicApiKey) {
    const authResult = authenticatePublicApiRequest(request);

    if (!authResult.ok) {
      sendJson(response, authResult.statusCode, { error: authResult.message }, headers);
      return;
    }
  }

  let validatedBody;

  try {
    const body = await readBody(request);
    validatedBody = validateRecommendationInput(body);
    const recommendation = await createRecommendation(validatedBody, options.dependencies);
    sendJson(response, 200, recommendation, headers);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: error.message }, headers);
      return;
    }

    if (validatedBody && shouldUseFallbackRecommendation(error)) {
      console.warn("Gemini recommendation failed; returning fallback recommendation.", error);
      sendJson(response, 200, buildFallbackRecommendation(validatedBody), {
        ...headers,
        "X-Recommendation-Source": "fallback"
      });
      return;
    }

    const statusCode = error.message.includes("GEMINI_API_KEY") ? 500 : 502;
    sendJson(response, statusCode, {
      error: error.message
    }, headers);
  }
}

function createRequestHandler(dependencies = {}) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const { pathname } = requestUrl;

    if (request.method === "OPTIONS" && pathname === PUBLIC_API_PATH) {
      const corsHeaders = getPublicCorsHeaders(request);

      if (!corsHeaders) {
        sendJson(response, 403, { error: "Origin is not allowed for the public API." });
        return;
      }

      sendNoContent(response, 204, corsHeaders);
      return;
    }

    if (request.method === "GET" && pathname === HEALTH_PATH) {
      sendJson(response, 200, {
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        publicApiConfigured: Boolean(process.env.PUBLIC_API_KEY),
        status: "ok",
        uptimeSeconds: Math.round(process.uptime())
      });
      return;
    }

    if (request.method === "GET" && pathname === API_DOCS_PATH) {
      const corsHeaders = getPublicCorsHeaders(request) || {};
      sendJson(response, 200, buildApiDocs(request), corsHeaders);
      return;
    }

    if (request.method === "POST" && pathname === APP_API_PATH) {
      await handleRecommendationRequest(request, response, {
        dependencies,
        rateLimitScope: "website-api",
        requireSameOrigin: true
      });
      return;
    }

    if (request.method === "POST" && pathname === PUBLIC_API_PATH) {
      const corsHeaders = getPublicCorsHeaders(request);

      if (!corsHeaders) {
        sendJson(response, 403, { error: "Origin is not allowed for the public API." });
        return;
      }

      await handleRecommendationRequest(request, response, {
        corsHeaders,
        dependencies,
        rateLimitScope: "public-api",
        requirePublicApiKey: true
      });
      return;
    }

    if (request.method === "GET") {
      serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  };
}

function createServer(dependencies = {}) {
  return http.createServer(createRequestHandler(dependencies));
}

loadEnvFile();

const server = createServer();

function startServer({ host = readHost(), port = readPort(), serverInstance = server } = {}) {
  return serverInstance.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
  });
}

function shutdownServer(serverInstance = server) {
  return new Promise((resolve, reject) => {
    serverInstance.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function installSignalHandlers(serverInstance = server) {
  let isShuttingDown = false;

  const handleSignal = async (signal) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);

    const forcedExitTimer = setTimeout(() => {
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    forcedExitTimer.unref();

    try {
      await shutdownServer(serverInstance);
      process.exit(0);
    } catch (error) {
      console.error("Graceful shutdown failed:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });

  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });
}

if (require.main === module) {
  startServer();
  installSignalHandlers();
}

module.exports = {
  API_DOCS_PATH,
  APP_API_PATH,
  HEALTH_PATH,
  PUBLIC_API_PATH,
  applyRateLimit,
  authenticatePublicApiRequest,
  buildApiDocs,
  buildFallbackRecommendation,
  createRecommendation,
  createRequestHandler,
  createServer,
  formatGeminiError,
  getGeminiRetryDelayMs,
  getGeminiModelNames,
  getPublicCorsHeaders,
  isRetryableGeminiStatus,
  isSameOriginRequest,
  readHost,
  readPort,
  validateRecommendationInput,
  shutdownServer,
  startServer
};
