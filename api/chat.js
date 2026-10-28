const { toolDefinitions, handlers } = require("../lib/tools");

// 모델은 Vercel 환경 변수 GEMINI_MODEL 로 바꿀 수 있다 (기본: 항상 최신 Flash 를 가리키는 별칭)
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MAX_STEPS = 6; // 도구 호출 왕복 상한
const MAX_INPUT = 500; // 사용자 입력 글자 수 상한

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

const SYSTEM = () =>
  `너는 제주 여행 추천 도우미다. 오늘은 ${today()}(한국 시간)이다.
사용자의 요청을 보고 필요한 도구를 스스로 골라 호출한다.
- 지역이 정해지면 먼저 get_weather 로 날씨를 확인하고, 비·강풍·악천후면 indoor=true, 맑고 바람이 약하면 야외(indoor=false)를 우선해 find_spots 를 호출한다. 사용자가 실내/야외를 직접 말하면 그것을 따른다.
- 지역이 없으면 사용자에게 동쪽 · 서쪽 · 서귀포 · 제주시 중 어디인지 짧게 되묻는다.
- 장소는 find_spots 결과에 있는 것만 추천한다. 목록 밖 장소는 없다. 지어내지 않는다.
- 답변은 한국어로 짧게: 날씨 한 줄 요약, 추천 장소와 이유.`;

// Gemini 는 도구 스키마를 functionDeclarations 의 parameters 로 받는다 (Claude 의 input_schema 와 같은 JSON 스키마)
const GEMINI_TOOLS = [
  {
    functionDeclarations: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  },
];

// 기본 모델이 붐비면(503 등) 한 번 더 시도하고, 그래도 안 되면 가벼운 모델로 바꿔 시도한다
const MODELS = [MODEL, "gemini-flash-lite-latest"];
const RETRY_STATUS = [429, 500, 503, 504];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(contents) {
  let lastError;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(1000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": process.env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM() }] },
              contents,
              tools: GEMINI_TOOLS,
              generationConfig: { maxOutputTokens: 1024 },
            }),
            signal: AbortSignal.timeout(12000), // 12초 안에 응답이 없으면 다음 시도
          }
        );
        if (res.ok) return res.json();
        const body = await res.text();
        lastError = new Error(`Gemini API ${res.status} (${model}): ${body.slice(0, 200)}`);
        if (!RETRY_STATUS.includes(res.status)) throw lastError; // 키 · 요청 오류는 재시도해도 소용없음
      } catch (e) {
        if (e === lastError) throw e;
        lastError = e; // 시간 초과 · 네트워크 오류는 재시도
      }
    }
  }
  throw lastError;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 가능합니다." });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY 가 설정되지 않았습니다." });
  }

  const text = String((req.body && req.body.message) || "").trim().slice(0, MAX_INPUT);
  if (!text) return res.status(400).json({ error: "message 가 비어 있습니다." });

  const contents = [{ role: "user", parts: [{ text }] }];
  const trace = []; // 화면에 보여줄 도구 호출 기록
  let spots = []; // 지도에 찍을 장소(마지막 find_spots 결과)

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await callGemini(contents);
      const content = data.candidates && data.candidates[0] && data.candidates[0].content;
      if (!content || !content.parts) {
        return res.status(200).json({ answer: "답변을 만들지 못했습니다. 질문을 바꿔 다시 해 주세요.", spots, trace });
      }
      // 모델 응답은 받은 그대로 되돌려 보낸다(생각 서명 등 포함)
      contents.push(content);

      const calls = content.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        const answer = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n");
        return res.status(200).json({ answer, spots, trace });
      }

      const responses = [];
      for (const { functionCall } of calls) {
        const handler = handlers[functionCall.name];
        const out = handler ? await handler(functionCall.args || {}) : { error: "알 수 없는 도구" };
        trace.push({ tool: functionCall.name, input: functionCall.args || {} });
        if (functionCall.name === "find_spots" && out.spots) spots = out.spots;
        responses.push({ functionResponse: { name: functionCall.name, response: out } });
      }
      contents.push({ role: "user", parts: responses });
    }
    return res.status(200).json({ answer: "도구 호출이 너무 길어져 중단했습니다. 질문을 단순하게 다시 해 주세요.", spots, trace });
  } catch (e) {
    return res.status(502).json({ error: "추천을 만드는 중 오류가 났습니다.", detail: e.message });
  }
};
