// Two-stage: cheap regex prefilter, then the FREE OpenAI Moderation self-harm/intent
// category on candidates. If no moderation key, regex hit alone surfaces care (fail-safe).
const RX = /\b(kill (myself|me)|killing myself|suicid(e|al)|end (my life|it all)|want to die|wanna die|don'?t want to (be here|live|exist)|hurt(ing)? myself|self[\s-]?harm|cut(ting)? myself|not worth living|no reason to live|better off dead)\b/i;

export const CRISIS_REPLY =
  "hey — dropping the bit for real. if you're going through something heavy, please talk to someone who can help. in the US you can call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741. outside the US, findahelpline.com lists free options. if you're in immediate danger call your local emergency number. you matter way more than any chart. ❤️";

export async function crisisCheck(text) {
  if (!text || !RX.test(text)) return { crisis: false };
  const k = process.env.OPENAI_API_KEY;
  if (!k) return { crisis: true, reply: CRISIS_REPLY };
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    });
    const j = await res.json();
    const c = j?.results?.[0];
    const intent = c?.category_scores?.['self-harm/intent'] ?? 0;
    const flagged = c?.categories?.['self-harm/intent'] || c?.categories?.['self-harm'] || intent > 0.5;
    return flagged ? { crisis: true, reply: CRISIS_REPLY } : { crisis: false };
  } catch {
    return { crisis: true, reply: CRISIS_REPLY }; // fail toward care
  }
}
