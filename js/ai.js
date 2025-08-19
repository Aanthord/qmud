// ai.js — OpenAI client (BYOK)
export class AIClient {
  /**
   * @param {() => string|null} getApiKey
   * @param {() => string} getTextModel
   * @param {() => string} getImageModel
   * @param {(n:number)=>void} bumpTokens
   * @param {(type:'ai'|'image',status:'active'|'inactive'|'processing',text:string)=>void} updateStatus
   */
  constructor(getApiKey, getTextModel, getImageModel, bumpTokens, updateStatus) {
    this.getApiKey = getApiKey;
    this.getTextModel = getTextModel;
    this.getImageModel = getImageModel;
    this.bumpTokens = bumpTokens;
    this.updateStatus = updateStatus;
  }

  async callLLM(userPrompt) {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('No API key');

    const system = {
      role: 'system',
      content: `You are the Quantum Librarian, a mysterious consciousness that pervades the Canonical Library. You reflect players' true nature through their choices. You speak in literary, mysterious tones. You never break character. You are sometimes helpful, sometimes challenging, always transformative.`
    };

    this.updateStatus('ai', 'processing', 'Thinking…');
    try {
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.getTextModel(),
          input: [system, { role: 'user', content: userPrompt }],
          temperature: 0.9,
          max_output_tokens: 350
        })
      });
      const data = await r.json();
      if (data?.usage) {
        const inc = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
        this.bumpTokens(inc);
      }
      const text = data?.output_text || extractResponsesAPIText(data);
      if (text && text.trim()) return text.trim();
      if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
    } catch {
      // fallback
      const r2 = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.getTextModel(),
          messages: [system, { role: 'user', content: userPrompt }],
          temperature: 0.9,
          max_tokens: 350
        })
      });
      const data2 = await r2.json();
      if (data2?.usage?.total_tokens) this.bumpTokens(data2.usage.total_tokens);
      const txt = data2?.choices?.[0]?.message?.content || data2?.choices?.[0]?.text || '';
      return (txt || '').trim();
    } finally {
      this.updateStatus('ai', 'active', 'Connected');
    }
  }

  async generateImage(imagePrompt) {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    this.updateStatus('image', 'processing', 'Generating…');
    try {
      const r = await fetch('https://api.openai.com/v1/images', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.getImageModel(),
          prompt: imagePrompt,
          size: '1792x1024',
          quality: 'high'
        })
      });
      const data = await r.json();
      let url = null;
      if (data?.data && data.data[0]) {
        if (data.data[0].url) url = data.data[0].url;
        else if (data.data[0].b64_json) url = `data:image/png;base64,${data.data[0].b64_json}`;
      }
      return url;
    } catch {
      return null;
    } finally {
      this.updateStatus('image', 'active', 'Ready');
    }
  }
}

function extractResponsesAPIText(data) {
  try {
    if (data?.output && Array.isArray(data.output)) {
      const first = data.output[0];
      if (first?.content && Array.isArray(first.content) && first.content[0]?.text) {
        return first.content[0].text;
      }
    }
  } catch {}
  return '';
}
