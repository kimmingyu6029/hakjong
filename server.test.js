const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APP_API_PATH,
  HEALTH_PATH,
  PUBLIC_API_PATH,
  createRecommendation,
  createServer,
  shutdownServer
} = require("./server");

function createErrorResponse(status, payload) {
  return {
    ok: false,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function createSuccessResponse(recommendation) {
  return {
    ok: true,
    async json() {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify(recommendation)
                }
              ]
            }
          }
        ]
      };
    }
  };
}

async function listenOnRandomPort(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port.");
  }

  return `http://127.0.0.1:${address.port}`;
}

function getSamplePayload() {
  return {
    teamName: "Team One",
    target: "students",
    problem: "stress in study spaces",
    technology: "AI floor-plan generation",
    majors: ["computer science", "architecture", "psychology"]
  };
}

function getSampleRecommendation() {
  return {
    topicTitle: "Adaptive Study Space Planner",
    topicSummary: "A recommendation for a calmer classroom layout.",
    recordText: "The team explored a data-driven classroom planning idea.",
    questions: ["q1", "q2", "q3", "q4"],
    activities: ["a1", "a2", "a3", "a4"],
    aiPrompt: "Expand this topic into a student research project."
  };
}

test("createRecommendation retries a transient Gemini 503 response", async () => {
  process.env.GEMINI_API_KEY = "test-api-key";

  const waits = [];
  const expected = getSampleRecommendation();
  let attempts = 0;

  const result = await createRecommendation(getSamplePayload(), {
    fetchImpl: async () => {
      attempts += 1;

      if (attempts === 1) {
        return createErrorResponse(503, {
          error: {
            message: "This model is currently experiencing high demand."
          }
        });
      }

      return createSuccessResponse(expected);
    },
    waitImpl: async (ms) => {
      waits.push(ms);
    }
  });

  assert.equal(attempts, 2);
  assert.deepEqual(waits, [400]);
  assert.deepEqual(result, expected);
});

test("createRecommendation does not retry a non-retryable Gemini 400 response", async () => {
  process.env.GEMINI_API_KEY = "test-api-key";

  let attempts = 0;
  const waits = [];

  await assert.rejects(
    () => createRecommendation(
      {
        teamName: "Team One",
        target: "students",
        problem: "stress in study spaces",
        technology: "AI floor-plan generation",
        majors: ["computer science"]
      },
      {
        fetchImpl: async () => {
          attempts += 1;
          return createErrorResponse(400, {
            error: {
              message: "The request payload is invalid."
            }
          });
        },
        waitImpl: async (ms) => {
          waits.push(ms);
        }
      }
    ),
    /Gemini API error \(400\): The request payload is invalid\./
  );

  assert.equal(attempts, 1);
  assert.deepEqual(waits, []);
});

test("public API enforces API key auth and CORS", async (t) => {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.PUBLIC_API_KEY = "public-secret";
  process.env.PUBLIC_API_CORS_ORIGINS = "https://client.example";

  const server = createServer({
    fetchImpl: async () => createSuccessResponse(getSampleRecommendation())
  });

  t.after(async () => {
    await shutdownServer(server);
    delete process.env.PUBLIC_API_KEY;
    delete process.env.PUBLIC_API_CORS_ORIGINS;
  });

  const baseUrl = await listenOnRandomPort(server);

  const preflightResponse = await fetch(`${baseUrl}${PUBLIC_API_PATH}`, {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Headers": "content-type,x-api-key",
      "Access-Control-Request-Method": "POST",
      Origin: "https://client.example"
    }
  });

  assert.equal(preflightResponse.status, 204);
  assert.equal(preflightResponse.headers.get("access-control-allow-origin"), "https://client.example");

  const unauthorizedResponse = await fetch(`${baseUrl}${PUBLIC_API_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://client.example"
    },
    body: JSON.stringify(getSamplePayload())
  });

  assert.equal(unauthorizedResponse.status, 401);
  const unauthorizedBody = await unauthorizedResponse.json();
  assert.match(unauthorizedBody.error, /Missing API key/);
});

test("public API accepts server-to-server requests with a valid API key", async (t) => {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.PUBLIC_API_KEY = "public-secret";
  delete process.env.PUBLIC_API_CORS_ORIGINS;

  const expected = getSampleRecommendation();
  const server = createServer({
    fetchImpl: async () => createSuccessResponse(expected)
  });

  t.after(async () => {
    await shutdownServer(server);
    delete process.env.PUBLIC_API_KEY;
  });

  const baseUrl = await listenOnRandomPort(server);

  const response = await fetch(`${baseUrl}${PUBLIC_API_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "public-secret"
    },
    body: JSON.stringify(getSamplePayload())
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, expected);
  assert.equal(response.headers.get("x-ratelimit-limit"), "30");
});

test("same-origin website API rejects cross-origin browser requests", async (t) => {
  process.env.GEMINI_API_KEY = "test-api-key";

  const server = createServer({
    fetchImpl: async () => createSuccessResponse(getSampleRecommendation())
  });

  t.after(async () => {
    await shutdownServer(server);
  });

  const baseUrl = await listenOnRandomPort(server);

  const response = await fetch(`${baseUrl}${APP_API_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example"
    },
    body: JSON.stringify(getSamplePayload())
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /Cross-origin browser access is not allowed/);
});

test("health endpoint reports deployment readiness", async (t) => {
  process.env.GEMINI_API_KEY = "test-api-key";
  process.env.PUBLIC_API_KEY = "public-secret";

  const server = createServer();

  t.after(async () => {
    await shutdownServer(server);
    delete process.env.PUBLIC_API_KEY;
  });

  const baseUrl = await listenOnRandomPort(server);
  const response = await fetch(`${baseUrl}${HEALTH_PATH}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.geminiConfigured, true);
  assert.equal(body.publicApiConfigured, true);
});
