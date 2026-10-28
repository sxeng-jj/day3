const fs = require("fs");
const path = require("path");

const AREAS = ["동쪽", "서쪽", "서귀포", "제주시"];
const MAX_RESULTS = 8;

// 지역 대표 좌표(날씨 조회용 근사값)
const AREA_CENTER = {
  동쪽: [33.46, 126.88],
  서쪽: [33.36, 126.3],
  서귀포: [33.25, 126.56],
  제주시: [33.51, 126.52],
};

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

// WMO 날씨 코드 → 한글 (Open-Meteo weather_code)
function codeText(c) {
  if (c === 0) return "맑음";
  if (c <= 3) return "구름 조금~흐림";
  if (c === 45 || c === 48) return "안개";
  if (c >= 51 && c <= 57) return "이슬비";
  if (c >= 61 && c <= 67) return "비";
  if (c >= 71 && c <= 77) return "눈";
  if (c >= 80 && c <= 82) return "소나기";
  if (c === 85 || c === 86) return "눈 소나기";
  if (c >= 95) return "뇌우";
  return "알 수 없음";
}

// https://open-meteo.com/en/docs — API 키 없이 사용
async function get_weather({ area, date } = {}) {
  if (!AREA_CENTER[area]) {
    return { error: `area 는 ${AREAS.join(" · ")} 중 하나여야 합니다.` };
  }
  const [lat, lon] = AREA_CENTER[area];
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,precipitation,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max" +
    "&timezone=Asia%2FSeoul&forecast_days=7";
  const res = await fetch(url);
  if (!res.ok) return { error: `날씨 조회 실패(${res.status})` };
  const w = await res.json();

  const i = date ? w.daily.time.indexOf(date) : 0;
  if (i < 0) {
    return { error: `date 는 오늘부터 7일 이내(${w.daily.time[0]} ~ ${w.daily.time[6]})여야 합니다.` };
  }
  const day = {
    date: w.daily.time[i],
    weather: codeText(w.daily.weather_code[i]),
    temp_max: w.daily.temperature_2m_max[i],
    temp_min: w.daily.temperature_2m_min[i],
    precipitation_mm: w.daily.precipitation_sum[i],
    precipitation_probability_pct: w.daily.precipitation_probability_max[i],
    wind_max_kmh: w.daily.wind_speed_10m_max[i],
  };
  const out = { area, day };
  if (i === 0) {
    out.now = {
      weather: codeText(w.current.weather_code),
      temp: w.current.temperature_2m,
      precipitation_mm: w.current.precipitation,
      wind_kmh: w.current.wind_speed_10m,
    };
  }
  return out;
}

const AREA_PROP = {
  type: "string",
  enum: AREAS,
  description: "지역",
};

const toolDefinitions = [
  {
    name: "find_spots",
    description:
      "제주 관광지 목록(jeju_spots.json)에서 지역과 실내 여부로 장소를 찾아 이름 · 지역 · 실내 여부 · 설명과 지도 표시용 좌표(lat, lon)를 최대 8곳 돌려준다. " +
      "목록 밖 장소는 없다: 결과에 없는 장소를 지어내거나 추천하지 말고, 결과가 비면 조건에 맞는 장소가 목록에 없다고 답한다.",
    input_schema: {
      type: "object",
      properties: {
        area: AREA_PROP,
        indoor: {
          type: "boolean",
          description: "true 면 실내만, false 면 야외만. 생략하면 둘 다.",
        },
      },
      required: ["area"],
    },
  },
  {
    name: "get_weather",
    description:
      "Open-Meteo 로 제주 지역의 날씨(현재 · 하루 예보: 날씨, 최고/최저 기온, 강수량, 강수확률, 최대 풍속)를 조회한다. " +
      "오늘부터 7일 이내만 조회할 수 있다. 실내/야외 장소를 고르기 전에 날씨를 확인할 때 쓴다.",
    input_schema: {
      type: "object",
      properties: {
        area: AREA_PROP,
        date: {
          type: "string",
          description: "YYYY-MM-DD. 오늘부터 7일 이내. 생략하면 오늘.",
        },
      },
      required: ["area"],
    },
  },
];

const handlers = { find_spots, get_weather };

module.exports = { toolDefinitions, handlers, find_spots, get_weather };
