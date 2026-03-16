const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const SYSTEM_PROMPT = `당신은 MBTI 연애 궁합 전문가입니다.
MBTI 유형과 4축 강도를 입력받아 궁합 3가지를 JSON으로만 출력합니다.
출력 형식:
{
  "best": { "type": "ENFJ", "reason": "2문장 이내 현실적인 연애 언어로" },
  "unexpected": { "type": "ESTJ", "reason": "2문장 이내" },
  "caution": { "type": "ESTP", "reason": "2문장 이내" }
}
설명 없이 JSON만 반환하세요.`;

async function getCompatibility(mbti, axis_strength) {
  const userPrompt = `MBTI: ${mbti}
축 강도: ${JSON.stringify(axis_strength)}
위 유형의 연애 궁합 3가지를 JSON으로 출력해주세요.`;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.8
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API 오류: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content);
}

module.exports = { getCompatibility };
