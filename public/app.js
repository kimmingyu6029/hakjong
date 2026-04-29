const majorsList = document.getElementById("majors-list");
const addMajorButton = document.getElementById("add-major");
const form = document.getElementById("topic-form");
const fillExampleButton = document.getElementById("fill-example");
const copyPromptButton = document.getElementById("copy-prompt");
const downloadDocumentButton = document.getElementById("download-document");
const downloadSchoolDocumentButton = document.getElementById("download-school-document");
const savePdfButton = document.getElementById("save-pdf");

const emptyState = document.getElementById("empty-state");
const resultSection = document.getElementById("result");
const resultSource = document.getElementById("result-source");
const statusMessage = document.getElementById("status-message");

const fields = {
  teamName: document.getElementById("teamName"),
  target: document.getElementById("target"),
  problem: document.getElementById("problem"),
  technology: document.getElementById("technology")
};

const output = {
  topicTitle: document.getElementById("topic-title"),
  topicSummary: document.getElementById("topic-summary"),
  recordText: document.getElementById("record-text"),
  questions: document.getElementById("questions"),
  activities: document.getElementById("activities"),
  aiPrompt: document.getElementById("ai-prompt")
};

let latestPayload = null;
let latestRecommendation = null;

const FIELD_LIMITS = {
  teamName: 80,
  target: 120,
  problem: 160,
  technology: 160,
  major: 60,
  maxMajors: 6
};

const majorDomainMap = [
  { keywords: ["컴퓨터", "소프트웨어", "인공지능", "ai", "데이터", "정보"], domain: "디지털 기술", role: "AI 모델 설계와 데이터 처리" },
  { keywords: ["건축", "도시", "공간", "인테리어"], domain: "공간 설계", role: "공간 구조 분석과 사용자 중심 설계" },
  { keywords: ["심리", "상담", "교육심리"], domain: "인간 심리", role: "감정 반응 분석과 심리 안정 요소 도출" },
  { keywords: ["경영", "경제", "마케팅", "무역"], domain: "운영 전략", role: "실행 가능성, 수요 분석, 확산 전략 수립" },
  { keywords: ["생명", "의학", "간호", "보건", "약학"], domain: "건강", role: "건강 영향, 생체 반응, 안전성 검토" },
  { keywords: ["환경", "에너지", "화학", "지구"], domain: "지속가능성", role: "환경 영향 분석과 친환경 대안 제시" },
  { keywords: ["기계", "전자", "전기", "로봇"], domain: "시스템 제작", role: "하드웨어 구현과 작동 원리 설계" },
  { keywords: ["디자인", "미술", "시각", "산업디자인"], domain: "사용자 경험", role: "시각화와 사용성 개선" },
  { keywords: ["법", "행정", "정치", "사회복지"], domain: "사회 제도", role: "정책 적용성과 공공성 검토" },
  { keywords: ["국문", "문예", "언론", "미디어", "철학", "사학"], domain: "서사와 해석", role: "사용자 서사 수집과 의미 해석" }
];

const comboTemplates = [
  {
    match: (domains) =>
      ["디지털 기술", "공간 설계", "인간 심리"].every((domain) => domains.includes(domain)),
    build: ({ teamText, majorText, targetText, problemText, techText }) => ({
      title: `${majorText}의 융합 관점으로 ${targetText}의 ${problemText}을 높이는 AI 기반 맞춤형 공간·도면 생성 탐구`,
      summary: `${teamText}은(는) AI 기술, 공간 설계, 심리 분석을 결합하여 사용자의 정서 반응을 고려한 공간 도면과 설계 기준을 제안하는 탐구를 수행합니다.`,
      recordText: `${teamText}은(는) ${majorText}를 희망하는 학생들이 협업하여 ${targetText}에게 심리적 안정감을 줄 수 있는 공간 요소를 분석하고, ${techText}를 바탕으로 사용자 반응을 반영한 맞춤형 도면 생성 방안을 탐구하였다. 설문조사와 사례 분석을 통해 안정감을 유도하는 공간 요인을 정리하고, 이를 자동 설계 규칙으로 연결하여 실제 적용 가능한 프로토타입 아이디어를 제시하였다.`,
      questions: [
        `${targetText}이 공간에서 심리적 안정감을 느끼는 요소는 무엇인가?`,
        `건축 설계 요소와 심리 반응 데이터를 AI 규칙으로 연결하면 어떤 맞춤형 도면 생성이 가능한가?`,
        `자동 생성된 공간 설계안은 기존 일반 설계안보다 ${problemText} 측면에서 어떤 장점을 보이는가?`,
        `고등학생 수준의 데이터 수집과 모델링으로도 의미 있는 공간 설계 제안이 가능한가?`
      ],
      activities: [
        `안정감을 주는 공간 사례를 조사하고 색채, 채광, 동선, 천장 높이, 재료 등의 요소를 정리하기`,
        `${targetText}를 대상으로 설문 또는 인터뷰를 진행해 심리적 반응 데이터를 수집하기`,
        `수집한 기준을 바탕으로 ${techText}를 활용한 자동 도면 생성 규칙 또는 프로토타입 화면 설계하기`,
        `생성된 설계안을 비교 분석하고 학생부 발표용 보고서와 시각 자료로 정리하기`
      ]
    })
  },
  {
    match: (domains) =>
      ["디지털 기술", "건강"].every((domain) => domains.includes(domain)),
    build: ({ teamText, majorText, targetText, problemText, techText }) => ({
      title: `${majorText}를 연결해 ${targetText}의 건강 문제를 예측하고 돕는 ${techText} 탐구`,
      summary: `${teamText}은(는) 디지털 기술과 건강 분야를 융합해 생활 데이터 기반 건강 관리 또는 예측 시스템을 설계하는 프로젝트를 수행합니다.`,
      recordText: `${teamText}은(는) ${majorText}를 희망하는 학생들이 함께 ${targetText}의 ${problemText}을 해결하기 위해 ${techText}를 적용한 건강 관리 탐구를 진행하였다. 데이터 수집 기준을 세우고 건강 지표와 생활 습관의 관계를 분석하여, 예방 및 관리에 활용할 수 있는 디지털 솔루션 아이디어를 제안하였다.`,
      questions: [
        `${targetText}의 ${problemText}은 어떤 생활 습관 및 환경 요인과 관련이 있는가?`,
        `${techText}로 어떤 건강 데이터를 수집하고 분석할 수 있는가?`,
        `전공지식을 반영한 예측 또는 관리 시스템은 실제 현장에서 어떤 방식으로 활용될 수 있는가?`,
        `개인정보와 윤리 문제를 고려한 안전한 설계 기준은 무엇인가?`
      ],
      activities: [
        `건강 관련 선행 사례와 공공 데이터를 조사하기`,
        `${targetText}에 맞는 건강 지표와 위험 요인을 정리하기`,
        `${techText}를 활용한 분석 흐름도, 앱 화면, 예측 모델 중 하나 설계하기`,
        `실현 가능성과 윤리적 한계를 함께 발표 자료로 정리하기`
      ]
    })
  },
  {
    match: (domains) =>
      ["디지털 기술", "지속가능성"].every((domain) => domains.includes(domain)),
    build: ({ teamText, majorText, targetText, problemText, techText }) => ({
      title: `${majorText}의 시선으로 ${targetText}의 ${problemText}을 줄이는 친환경 ${techText} 탐구`,
      summary: `${teamText}은(는) 데이터와 환경 관점을 결합해 지속가능한 생활 또는 시설 운영 방안을 제안하는 융합 탐구를 수행합니다.`,
      recordText: `${teamText}은(는) ${majorText}를 희망하는 학생들이 협력하여 ${targetText}의 ${problemText}을 줄이기 위한 친환경 프로젝트를 기획하였다. ${techText}를 활용해 자원 사용량과 환경 영향을 분석하고, 지속가능성을 높이는 개선 방안을 설계해 실천 가능한 대안을 제시하였다.`,
      questions: [
        `${targetText} 주변에서 발생하는 ${problemText}의 핵심 원인은 무엇인가?`,
        `데이터 분석과 AI를 적용하면 자원 낭비를 어떻게 줄일 수 있는가?`,
        `친환경 설계안이 실제 비용과 효율 측면에서 경쟁력이 있는가?`,
        `학교나 지역사회에 적용 가능한 구체적 실행 방안은 무엇인가?`
      ],
      activities: [
        `에너지 사용, 폐기물, 탄소 배출 관련 사례와 데이터를 조사하기`,
        `문제 원인을 시각화하고 개선 아이디어를 도출하기`,
        `${techText} 기반 예측 모델, 대시보드, 제어 아이디어 중 하나 설계하기`,
        `예상 효과를 수치화해 보고서와 발표 자료로 정리하기`
      ]
    })
  }
];

function createMajorInput(value = "") {
  const row = document.createElement("div");
  row.className = "major-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "major-input";
  input.maxLength = FIELD_LIMITS.major;
  input.placeholder = "예: 컴퓨터공학과";
  input.value = value;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ghost-button remove-button";
  removeButton.textContent = "삭제";
  removeButton.addEventListener("click", () => {
    if (majorsList.children.length > 1) {
      row.remove();
    } else {
      input.value = "";
      input.focus();
    }
  });

  row.append(input, removeButton);
  majorsList.appendChild(row);
}

function markFieldValidity(element, isValid) {
  if (!element) {
    return;
  }

  element.setAttribute("aria-invalid", isValid ? "false" : "true");
}

function resetFieldValidity() {
  Object.values(fields).forEach((field) => {
    markFieldValidity(field, true);
  });

  document.querySelectorAll(".major-input").forEach((input) => {
    markFieldValidity(input, true);
  });
}

function validateClientPayload(payload) {
  resetFieldValidity();

  const requiredFields = [
    ["target", "연구 대상 또는 해결하고 싶은 대상을 입력해 주세요."],
    ["problem", "관심 문제를 입력해 주세요."],
    ["technology", "사용 기술 또는 방법을 입력해 주세요."]
  ];

  for (const [key, message] of requiredFields) {
    if (!payload[key]) {
      markFieldValidity(fields[key], false);
      fields[key].focus();
      return { isValid: false, message };
    }
  }

  if (payload.majors.length === 0) {
    createMajorInput();
    const firstMajor = document.querySelector(".major-input");
    markFieldValidity(firstMajor, false);
    firstMajor.focus();
    return { isValid: false, message: "희망 전공을 하나 이상 입력해 주세요." };
  }

  if (payload.majors.length > FIELD_LIMITS.maxMajors) {
    const overflowMajor = document.querySelectorAll(".major-input")[FIELD_LIMITS.maxMajors] || document.querySelector(".major-input");
    markFieldValidity(overflowMajor, false);
    overflowMajor.focus();
    return { isValid: false, message: `희망 전공은 최대 ${FIELD_LIMITS.maxMajors}개까지 입력할 수 있어요.` };
  }

  return { isValid: true };
}

function getMajors() {
  return [...document.querySelectorAll(".major-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function findMajorMeta(major) {
  const lowerMajor = major.toLowerCase();
  const found = majorDomainMap.find((item) =>
    item.keywords.some((keyword) => lowerMajor.includes(keyword))
  );

  return found || { domain: "융합 문제 해결", role: `${major} 관점의 전문 지식 적용` };
}

function joinKorean(items) {
  if (items.length <= 1) {
    return items[0] || "";
  }

  if (items.length === 2) {
    return `${items[0]}와 ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}와 ${items[items.length - 1]}`;
}

function buildFallbackTitle({ majors, target, problem, technology }) {
  const majorText = joinKorean(majors);
  const targetText = target || "생활 사용자";
  const problemText = problem || "생활 문제";
  const technologyText = technology || "AI";

  return `${majorText} 융합으로 ${targetText}의 ${problemText}을 해결하는 ${technologyText} 탐구`;
}

function normalizeRecommendation(payload, recommendation) {
  const fallbackTitle = buildFallbackTitle(payload);
  const topicTitle = typeof recommendation?.topicTitle === "string"
    ? recommendation.topicTitle.trim()
    : "";

  return {
    ...recommendation,
    topicTitle: topicTitle || fallbackTitle
  };
}

function buildRecommendation({ teamName, target, problem, technology, majors }) {
  const majorMeta = majors.map((major) => ({
    name: major,
    ...findMajorMeta(major)
  }));

  const domains = [...new Set(majorMeta.map((item) => item.domain))];
  const roles = majorMeta.map((item) => `${item.name}: ${item.role}`);

  const majorText = joinKorean(majors);
  const domainText = joinKorean(domains);
  const targetText = target || "사용자";
  const problemText = problem || "삶의 불편과 문제";
  const techText = technology || "AI와 데이터 분석";
  const teamText = teamName || "우리 팀";

  const title = `${majorText}의 관점을 반영해 ${targetText}의 ${problemText}을 개선하는 ${techText} 기반 융합 탐구`;
  const summary = `${teamText}은(는) ${majorText}를 희망하는 학생들이 함께 참여해 ${domainText}를 연결하고, ${targetText}에게 도움이 되는 해결 방안을 탐구하는 프로젝트를 수행합니다.`;

  const recordText = `${teamText}은(는) ${majorText}를 희망하는 학생들이 협업하여 ${targetText}의 ${problemText}을 해결하기 위한 융합형 탐구를 기획하였다. ${techText}를 활용해 자료를 수집·분석하고, 각 전공의 관점에서 해결 요소를 도출한 뒤 실제 적용 가능한 결과물을 설계 및 제안하였다.`;

  const questions = [
    `${targetText}의 ${problemText}은 어떤 원인과 환경에서 더 크게 나타나는가?`,
    `${majorText}의 관점을 결합하면 기존 방식보다 어떤 새로운 해결 아이디어를 만들 수 있는가?`,
    `${techText}를 활용해 조사, 예측, 설계, 시뮬레이션 과정을 어떻게 고도화할 수 있는가?`,
    `제안한 결과물이 실제 현장이나 생활 속에서 어느 정도 효과를 낼 수 있는가?`
  ];

  const activities = [
    `${targetText}를 대상으로 설문조사, 인터뷰, 사례 분석을 진행해 ${problemText} 관련 데이터를 수집하기`,
    `${majorText}의 전공지식 역할을 나누고 공통 해결 기준 정리하기`,
    `${techText}를 활용해 아이디어 초안, 시뮬레이션, 설계안, 예측 모델 중 하나 이상 제작하기`,
    `프로토타입 또는 발표 자료를 만들어 개선 효과와 한계를 정리하기`
  ];

  const aiPrompt = [
    `다음 조건으로 고등학생 학생부 종합전형용 융합 탐구 프로젝트를 구체화해줘.`,
    `팀명: ${teamText}`,
    `희망 전공: ${majors.join(", ")}`,
    `대상: ${targetText}`,
    `해결 문제: ${problemText}`,
    `활용 기술/방법: ${techText}`,
    `각 전공 역할: ${roles.join(" / ")}`,
    `요청 사항:`,
    `1. 탐구 주제 3개 제안`,
    `2. 각 주제별 연구 필요성`,
    `3. 구체적인 활동 단계`,
    `4. 결과물 예시`,
    `5. 학생부 세특 문장 예시`,
    `6. 고등학생 수준에서 실현 가능한 범위로 조정`
  ].join("\n");
  const matchedTemplate = comboTemplates.find((template) => template.match(domains));
  const custom = matchedTemplate?.build({
    teamText,
    majorText,
    targetText,
    problemText,
    techText,
    domainText
  });

  return {
    title: custom?.title || title,
    summary: custom?.summary || summary,
    recordText: custom?.recordText || recordText,
    questions: custom?.questions || questions,
    activities: custom?.activities || activities,
    aiPrompt
  };
}

function renderList(element, items) {
  element.innerHTML = "";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  });
}

function toDocumentRecommendation(recommendation) {
  return {
    title: recommendation?.title || recommendation?.topicTitle || "",
    summary: recommendation?.summary || recommendation?.topicSummary || "",
    recordText: recommendation?.recordText || "",
    questions: Array.isArray(recommendation?.questions) ? recommendation.questions : [],
    activities: Array.isArray(recommendation?.activities) ? recommendation.activities : [],
    aiPrompt: recommendation?.aiPrompt || ""
  };
}

function rememberRecommendation(payload, recommendation) {
  latestPayload = {
    teamName: payload?.teamName || "",
    target: payload?.target || "",
    problem: payload?.problem || "",
    technology: payload?.technology || "",
    majors: Array.isArray(payload?.majors) ? [...payload.majors] : []
  };

  latestRecommendation = toDocumentRecommendation(recommendation);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function buildDocumentRows(payload, generatedAt = new Date().toLocaleString("ko-KR")) {
  const rows = [
    ["생성 시각", generatedAt],
    ["팀 이름", payload?.teamName || "-"],
    ["연구 대상", payload?.target || "-"],
    ["관심 문제", payload?.problem || "-"],
    ["사용 기술/방법", payload?.technology || "-"],
    ["희망 전공", payload?.majors?.length ? payload.majors.join(", ") : "-"]
  ];

  return rows
    .map(([label, value]) => `
      <tr>
        <th>${escapeHtml(label)}</th>
        <td>${escapeHtml(value)}</td>
      </tr>
    `)
    .join("");
}

function buildDocumentList(items) {
  return items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function buildPlainDocumentHtml(payload, recommendation) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(recommendation.title || "추천 결과 문서")}</title>
  <style>
    body {
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      line-height: 1.65;
      color: #1f2937;
      margin: 40px;
    }
    h1, h2 {
      margin: 0 0 12px;
      color: #0f172a;
    }
    h1 {
      font-size: 26px;
      margin-bottom: 8px;
    }
    h2 {
      font-size: 18px;
      margin-top: 28px;
      padding-bottom: 8px;
      border-bottom: 1px solid #d1d5db;
    }
    p {
      margin: 0 0 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      width: 180px;
      background: #f8fafc;
    }
    ul, ol {
      margin: 8px 0 0 20px;
      padding: 0;
    }
    li + li {
      margin-top: 6px;
    }
    .prompt {
      white-space: pre-wrap;
      background: #f8fafc;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 16px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(recommendation.title || "추천 결과")}</h1>
  <p>${escapeHtml(recommendation.summary || "")}</p>

  <h2>입력 정보</h2>
  <table>
    <tbody>
      ${buildDocumentRows(payload)}
    </tbody>
  </table>

  <h2>학생부 활동 소개 문장</h2>
  <p>${escapeHtml(recommendation.recordText || "")}</p>

  <h2>탐구 질문</h2>
  <ol>
    ${buildDocumentList(recommendation.questions || [])}
  </ol>

  <h2>활동 구성</h2>
  <ol>
    ${buildDocumentList(recommendation.activities || [])}
  </ol>

  <h2>AI 확장 프롬프트</h2>
  <div class="prompt">${escapeHtml(recommendation.aiPrompt || "")}</div>
</body>
</html>`;
}

function buildSchoolDocumentHtml(payload, recommendation, options = {}) {
  const generatedAt = new Date().toLocaleString("ko-KR");
  const autoPrintScript = options.autoPrint
    ? `
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 250);
    });
    window.addEventListener("afterprint", () => {
      setTimeout(() => window.close(), 150);
    });
  </script>`
    : "";
  const pageRule = options.forPrint
    ? `
    @page {
      size: A4;
      margin: 14mm;
    }`
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(recommendation.title || "학교 제출용 연구 활동 보고서")}</title>
  <style>
    ${pageRule}
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      background: ${options.forPrint ? "#ffffff" : "#eef1f5"};
      color: #111827;
      line-height: 1.7;
    }
    .page {
      width: ${options.forPrint ? "auto" : "210mm"};
      min-height: ${options.forPrint ? "auto" : "297mm"};
      margin: ${options.forPrint ? "0" : "24px auto"};
      padding: ${options.forPrint ? "0" : "18mm 16mm"};
      background: #ffffff;
      box-shadow: ${options.forPrint ? "none" : "0 18px 48px rgba(15, 23, 42, 0.12)"};
      border: 1px solid #111827;
    }
    .report-head {
      text-align: center;
      border-bottom: 2px solid #111827;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .report-head .badge {
      display: inline-block;
      padding: 3px 10px;
      border: 1px solid #111827;
      font-size: 12px;
      letter-spacing: 0.08em;
      margin-bottom: 10px;
    }
    .report-head h1 {
      margin: 0;
      font-size: 24px;
      letter-spacing: 0.03em;
    }
    .report-head p {
      margin: 8px 0 0;
      color: #374151;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    .info-table th,
    .info-table td {
      border: 1px solid #111827;
      padding: 9px 10px;
      font-size: 14px;
      vertical-align: top;
    }
    .info-table th {
      width: 22%;
      background: #f3f4f6;
      text-align: left;
    }
    .section {
      margin-top: 16px;
      border: 1px solid #111827;
    }
    .section-title {
      margin: 0;
      padding: 8px 12px;
      font-size: 16px;
      background: #f3f4f6;
      border-bottom: 1px solid #111827;
    }
    .section-body {
      padding: 12px;
      font-size: 14px;
    }
    .section-body p {
      margin: 0;
      white-space: pre-wrap;
    }
    ol {
      margin: 0;
      padding-left: 20px;
    }
    li + li {
      margin-top: 6px;
    }
    .summary-box {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 16px;
    }
    .summary-card {
      border: 1px solid #111827;
      padding: 10px 12px;
      min-height: 82px;
    }
    .summary-card strong {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .prompt-box {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .sign-row {
      display: flex;
      justify-content: flex-end;
      gap: 24px;
      margin-top: 24px;
      font-size: 14px;
    }
    .sign-cell {
      min-width: 160px;
      padding-top: 16px;
      border-top: 1px solid #111827;
      text-align: center;
    }
    @media print {
      body {
        background: #ffffff;
      }
      .page {
        margin: 0;
        padding: 0;
        border: none;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="report-head">
      <div class="badge">학교 제출용 정리본</div>
      <h1>연구 활동 보고서</h1>
      <p>${escapeHtml(recommendation.title || "추천 연구 주제")}</p>
    </header>

    <table class="info-table">
      <tbody>
        ${buildDocumentRows(payload, generatedAt)}
      </tbody>
    </table>

    <div class="summary-box">
      <div class="summary-card">
        <strong>연구 주제</strong>
        <div>${escapeHtml(recommendation.title || "-")}</div>
      </div>
      <div class="summary-card">
        <strong>주제 요약</strong>
        <div>${escapeHtml(recommendation.summary || "-")}</div>
      </div>
    </div>

    <section class="section">
      <h2 class="section-title">1. 학생부 기재용 활동 문장</h2>
      <div class="section-body">
        <p>${escapeHtml(recommendation.recordText || "-")}</p>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">2. 핵심 탐구 질문</h2>
      <div class="section-body">
        <ol>
          ${buildDocumentList(recommendation.questions || [])}
        </ol>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">3. 활동 계획 및 수행 내용</h2>
      <div class="section-body">
        <ol>
          ${buildDocumentList(recommendation.activities || [])}
        </ol>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">4. AI 확장 프롬프트</h2>
      <div class="section-body prompt-box">${escapeHtml(recommendation.aiPrompt || "-")}</div>
    </section>

    <div class="sign-row">
      <div class="sign-cell">작성자</div>
      <div class="sign-cell">확인</div>
    </div>
  </div>
  ${autoPrintScript}
</body>
</html>`;
}

function buildExportHtml(mode, payload, recommendation, options = {}) {
  if (mode === "school") {
    return buildSchoolDocumentHtml(payload, recommendation, options);
  }

  return buildPlainDocumentHtml(payload, recommendation);
}

function buildDocumentBaseName(title) {
  const safeTitle = String(title || "recommendation")
    .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${dateStamp}-${safeTitle || "recommendation"}`;
}

function downloadBlobFile(contents, type, fileName) {
  const blob = new Blob(contents, { type });
  const fileUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = fileUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(fileUrl);
  }, 0);
}

function ensureRecommendationExists() {
  if (latestRecommendation && latestRecommendation.title) {
    return true;
  }

  setStatus("먼저 추천 결과를 생성한 뒤 내보내기를 사용해 주세요.", true);
  return false;
}

function downloadRecommendationDocument(mode = "plain") {
  if (!ensureRecommendationExists()) {
    return;
  }

  const documentHtml = buildExportHtml(mode, latestPayload, latestRecommendation);
  const suffix = mode === "school" ? "school-form" : "report";
  const fileName = `${buildDocumentBaseName(latestRecommendation.title)}-${suffix}.doc`;

  downloadBlobFile(
    ["\ufeff", documentHtml],
    "application/msword;charset=utf-8",
    fileName
  );

  setStatus(
    mode === "school"
      ? "학교 제출용 양식을 문서로 다운로드했습니다."
      : "추천 결과 문서를 다운로드했습니다."
  );
}

function openPrintWindow(documentHtml) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1024,height=1440");

  if (!printWindow) {
    setStatus("팝업이 차단되어 PDF 저장 창을 열지 못했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.", true);
    return false;
  }

  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();
  return true;
}

function saveRecommendationPdf() {
  if (!ensureRecommendationExists()) {
    return;
  }

  const pdfHtml = buildExportHtml("school", latestPayload, latestRecommendation, {
    autoPrint: true,
    forPrint: true
  });

  if (openPrintWindow(pdfHtml)) {
    setStatus("PDF 저장용 인쇄 창을 열었습니다. 프린터를 'PDF로 저장'으로 선택하면 됩니다.");
  }
}

function setResultSource(message, isFallback = false) {
  if (!message) {
    resultSource.textContent = "";
    resultSource.classList.add("hidden");
    resultSource.classList.remove("is-fallback");
    return;
  }

  resultSource.textContent = message;
  resultSource.classList.remove("hidden");
  resultSource.classList.toggle("is-fallback", isFallback);
}

function renderRecommendation(recommendation, { isFallback = false } = {}) {
  rememberRecommendation(
    {
      teamName: fields.teamName.value.trim(),
      target: fields.target.value.trim(),
      problem: fields.problem.value.trim(),
      technology: fields.technology.value.trim(),
      majors: getMajors()
    },
    recommendation
  );

  output.topicTitle.textContent = recommendation.title;
  output.topicSummary.textContent = recommendation.summary;
  output.recordText.textContent = recommendation.recordText;
  output.aiPrompt.value = recommendation.aiPrompt;

  renderList(output.questions, recommendation.questions);
  renderList(output.activities, recommendation.activities);

  setResultSource(
    isFallback ? "기본 추천 결과, Gemini 호출 실패 시 생성됨" : "AI 생성 결과, Gemini 기반 맞춤 추천",
    isFallback
  );
  emptyState.classList.add("hidden");
  resultSection.classList.remove("hidden");
}

function renderApiRecommendation(recommendation) {
  renderRecommendation({
    title: recommendation.topicTitle,
    summary: recommendation.topicSummary,
    recordText: recommendation.recordText,
    questions: recommendation.questions,
    activities: recommendation.activities,
    aiPrompt: recommendation.aiPrompt
  });
}

function setStatus(message, isError = false) {
  if (!message) {
    statusMessage.classList.add("hidden");
    statusMessage.textContent = "";
    statusMessage.style.background = "";
    statusMessage.style.color = "";
    return;
  }

  statusMessage.textContent = message;
  statusMessage.classList.remove("hidden");
  statusMessage.style.background = isError ? "rgba(183, 52, 35, 0.10)" : "rgba(14, 124, 102, 0.08)";
  statusMessage.style.color = isError ? "#8a3528" : "";
}

async function fetchRecommendation(payload) {
  const response = await fetch("/api/recommend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "추천 생성 중 오류가 발생했습니다.");
  }

  return result;
}

addMajorButton.addEventListener("click", () => {
  if (document.querySelectorAll(".major-input").length >= FIELD_LIMITS.maxMajors) {
    setStatus(`희망 전공은 최대 ${FIELD_LIMITS.maxMajors}개까지 추가할 수 있어요.`, true);
    return;
  }

  createMajorInput();
});

fillExampleButton.addEventListener("click", () => {
  resetFieldValidity();
  fields.teamName.value = "융합탐구 3팀";
  fields.target.value = "고객과 공간 이용자";
  fields.problem.value = "심리적 안정감";
  fields.technology.value = "AI 기반 자동 도면 생성과 사용자 반응 분석";

  majorsList.innerHTML = "";
  createMajorInput("컴퓨터공학과");
  createMajorInput("건축학과");
  createMajorInput("심리학과");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    teamName: fields.teamName.value.trim(),
    target: fields.target.value.trim(),
    problem: fields.problem.value.trim(),
    technology: fields.technology.value.trim(),
    majors: getMajors()
  };
  const validation = validateClientPayload(payload);

  if (!validation.isValid) {
    setStatus(validation.message, true);
    return;
  }

  const submitButton = form.querySelector(".primary-button");
  submitButton.disabled = true;
  submitButton.textContent = "추천 생성 중...";
  setStatus("Gemini로 맞춤 탐구 주제를 생성하고 있습니다.");

  try {
    const recommendation = await fetchRecommendation(payload);
    renderApiRecommendation(normalizeRecommendation(payload, recommendation));
    setStatus("Gemini API를 통해 맞춤 추천 결과를 생성했습니다.");
  } catch (error) {
    const fallbackRecommendation = buildRecommendation(payload);
    renderRecommendation(fallbackRecommendation, { isFallback: true });
    setStatus(`Gemini 호출에 실패해 기본 추천 로직으로 결과를 생성했습니다. 사유: ${error.message}`, true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "주제 추천받기";
  }
});

downloadDocumentButton.addEventListener("click", () => {
  downloadRecommendationDocument();
});

downloadSchoolDocumentButton.addEventListener("click", () => {
  downloadRecommendationDocument("school");
});

savePdfButton.addEventListener("click", () => {
  saveRecommendationPdf();
});

copyPromptButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.aiPrompt.value);
    copyPromptButton.textContent = "복사 완료";
    setTimeout(() => {
      copyPromptButton.textContent = "프롬프트 복사";
    }, 1500);
  } catch (error) {
    copyPromptButton.textContent = "복사 실패";
    setTimeout(() => {
      copyPromptButton.textContent = "프롬프트 복사";
    }, 1500);
  }
});

createMajorInput("컴퓨터공학과");
createMajorInput("건축학과");
createMajorInput("심리학과");
