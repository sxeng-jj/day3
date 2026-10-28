const fs = require("fs");
const path = require("path");

const AREAS = ["동쪽", "서쪽", "서귀포", "제주시"];
const MAX_RESULTS = 8;

// 데이터의 area 는 "동쪽(성산)" 처럼 읍면이 붙어 있어서, 입력 area 로 시작하는 것을 같은 지역으로 본다.
const spots = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "jeju_spots.json"), "utf8")
).spots;

function find_spots({ area, indoor } = {}) {
  if (!AREAS.includes(area)) {
    return { error: `area 는 ${AREAS.join(" · ")} 중 하나여야 합니다.` };
  }
  const found = spots
    .filter((s) => s.area.startsWith(area))
    .filter((s) => indoor === undefined || indoor === null || s.indoor === indoor)
    .slice(0, MAX_RESULTS)
    .map((s) => ({
      name: s.name,
      area: s.area,
      indoor: s.indoor,
      desc: s.type,
      lat: s.lat,
      lon: s.lon,
    }));
  return { count: found.length, spots: found };
}

const toolDefinitions = [
  {
    name: "find_spots",
    description:
      "제주 관광지 목록(jeju_spots.json)에서 지역과 실내 여부로 장소를 찾아 이름 · 지역 · 실내 여부 · 설명과 지도 표시용 좌표(lat, lon)를 최대 8곳 돌려준다. " +
      "목록 밖 장소는 없다: 결과에 없는 장소를 지어내거나 추천하지 말고, 결과가 비면 조건에 맞는 장소가 목록에 없다고 답한다.",
    input_schema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: AREAS,
          description: "찾을 지역",
        },
        indoor: {
          type: "boolean",
          description: "true 면 실내만, false 면 야외만. 생략하면 둘 다.",
        },
      },
      required: ["area"],
    },
  },
];

const handlers = { find_spots };

module.exports = { toolDefinitions, handlers, find_spots };
