// Claude wrapper. Speed-first: low effort, short answers, non-streaming
// (readings are short, so a single round-trip is the fastest path in a
// serverless function).
const Anthropic = require('@anthropic-ai/sdk');
const cfg = require('./config');
const { SYSTEM } = require('./prompt');

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// messages: [{ role:'user'|'assistant', content:string }]
async function generate(messages, maxTokens) {
  const resp = await client.messages.create({
    model: cfg.MODEL,
    max_tokens: maxTokens || cfg.MAX_TOKENS_QUICK,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: cfg.EFFORT },
    messages: messages
  });

  if (resp.stop_reason === 'refusal') {
    return 'Прости, на этот вопрос я откликнуться не могу 🕯 Давай попробуем зайти с другой стороны — расскажи, что тебя на самом деле волнует?';
  }
  return resp.content
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n')
    .trim();
}

module.exports = { generate };
