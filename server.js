const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
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
  ".md": "text/markdown; charset=utf-8"
};

const rateLimitStore = new Map();

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
        reject(new Error("Request body too large"));
      }
    });

    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

function sanitizePathname(pathname) {
  const decoded = decodeURIComponent(pathname).replace(/\\/g, "/");
  const safePath = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.posix.normalize(safePath).replace(/^(\.\.\/)+/, "");
  const relativePath = normalized.replace(/^\/+/, "");
  return path.join(ROOT, relativePath);
}

function buildPrompt(data) {
  const majors = Array.isArray(data.majors) ? data.majors.filter(Boolean) : [];

  return [
    "You are an expert at designing interdisciplinary high-school research projects for student records.",
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
    `Target users or audience: ${data.target || "general users"}`,
    `Problem to solve: ${data.problem || "a real-life problem or inconvenience"}`,
    `Technology or method: ${data.technology || "AI and data analysis"}`,
    `Intended majors: ${majors.join(", ") || "none provided"}`,
    "",
    "Requirements:",
    "1. topicTitle must sound concrete and specific.",
    "2. topicSummary should be brief and clear.",
    "3. recordText should read naturally like a school activity or portfolio sentence.",
    "4. questions and activities must each contain exactly 4 items.",
    "5. aiPrompt should be a detailed follow-up prompt another AI can expand.",
    "6. Show a clear connection between the majors and suggest a realistic output or prototype.",
    "7. If the majors include computer science, architecture, and psychology, prioritize an AI-based space or floor-plan generation project that improves users' psychological comfort."
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

async function createRecommendation(
  data,
  {
    fetchImpl = fetch,
    waitImpl = wait,
    maxAttempts = GEMINI_MAX_ATTEMPTS
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;

    try {
      response = await fetchImpl(GEMINI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: requestBody
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await waitImpl(getGeminiRetryDelayMs(attempt));
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const geminiError = new Error(formatGeminiError(response.status, errorText));

      if (!isRetryableGeminiStatus(response.status) || attempt === maxAttempts) {
        throw geminiError;
      }

      await waitImpl(getGeminiRetryDelayMs(attempt));
      continue;
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

  throw new Error("Gemini API request failed after retries");
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
  const filePath = sanitizePathname(pathname);

  if (!filePath.startsWith(ROOT)) {
    sendJson(response, 403, { error: "Forbidden" });
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

  try {
    const body = await readBody(request);
    const recommendation = await createRecommendation(body, options.dependencies);
    sendJson(response, 200, recommendation, headers);
  } catch (error) {
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
  createRecommendation,
  createRequestHandler,
  createServer,
  formatGeminiError,
  getGeminiRetryDelayMs,
  getPublicCorsHeaders,
  isRetryableGeminiStatus,
  isSameOriginRequest,
  readHost,
  readPort,
  shutdownServer,
  startServer
};
