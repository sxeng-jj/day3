const { toolDefinitions, handlers } = require("../lib/tools");

const MODEL = "claude-sonnet-5-5";
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

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM(),
      tools: toolDefinitions,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 가능합니다." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 가 설정되지 않았습니다." });
  }

  const text = String((req.body && req.body.message) || "").trim().slice(0, MAX_INPUT);
  if (!text) return res.status(400).json({ error: "message 가 비어 있습니다." });

  const messages = [{ role: "user", content: text }];
  const trace = []; // 화면에 보여줄 도구 호출 기록
  let spots = []; // 지도에 찍을 장소(마지막 find_spots 결과)

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await callClaude(messages);
      messages.push({ role: "assistant", content: reply.content });

      if (reply.stop_reason !== "tool_use") {
        const answer = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        return res.status(200).json({ answer, spots, trace });
      }

      const results = [];
      for (const block of reply.content.filter((b) => b.type === "tool_use")) {
        const handler = handlers[block.name];
        const out = handler ? await handler(block.input) : { error: "알 수 없는 도구" };
        trace.push({ tool: block.name, input: block.input });
        if (block.name === "find_spots" && out.spots) spots = out.spots;
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }
    return res.status(200).json({ answer: "도구 호출이 너무 길어져 중단했습니다. 질문을 단순하게 다시 해 주세요.", spots, trace });
  } catch (e) {
    return res.status(502).json({ error: "추천을 만드는 중 오류가 났습니다.", detail: e.message });
  }
};
