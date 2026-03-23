const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * 타로 앱용 스토리 생성 (프롬프트는 클라이언트가 조합해 전달)
 */
async function generateTarotStory(userPrompt) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            '당신은 따뜻하고 공감적인 타로 스토리텔러입니다. 사용자가 준 프롬프트에 맞춰 한국어로 자연스러운 이야기만 작성합니다. JSON이나 메타 설명 없이 본문만 출력합니다.',
        },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.85,
    }),
  });

  if (!response.ok) {
    const t = await response.text();
    throw new Error(`DeepSeek API 오류: ${response.status} ${t}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek 응답에 본문이 없습니다.');
  }
  return content.trim();
}

module.exports = { generateTarotStory };
