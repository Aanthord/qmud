// OpenAI client (BYOK) with queue + backoff + configurable API base
export class AIClient {
  /**
   * @param {() => string|null} getApiKey
   * @param {() => string} getTextModel
   * @param {() => string} getImageModel
   * @param {(n:number)=>void} bumpTokens
   * @param {(type:'ai'|'image',status:'active'|'inactive'|'processing',text:string)=>void} updateStatus
   * @param {() => string} getApiBase
   */
  constructor(getApiKey, getTextModel, getImageModel, bumpTokens, updateStatus, getApiBase) {
    this.getApiKey = getApiKey;
    this.getTextModel = getTextModel;
    this.getImageModel = getImageModel;
    this.bumpTokens = bumpTokens;
    this.updateStatus = updateStatus;
    this.getApiBase = getApiBase || (() => (localStorage.getItem('qmud_api_base') || 'https://api.openai.com'));
  }

  // --- queue / backoff ---
  _inflight = Promise.resolve();
  _blockedUntil = 0;

  async _enqueue(task) {
    const run = async () => {
      const now = Date.now();
      if (now < this._blockedUntil) {
        const wait = Math.max(0, this._blockedUntil - now);
        return { skipped: true, wait };
      }
      return task();
    };
    this._inflight = this._inflight.then(run, run);
    return this._inflight;
  }

  _setBackoff(res) {
    const retry = Number(res.headers?.get?.('retry-after')) || 0;
    const ms = retry ? retry * 1000 : 8000;
    this._blockedUntil = Date.now() + ms;
  }

  async _doJSON(url, init) {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('No API key');
    return this._enqueue(async () => {
      init.headers = init.headers || {};
      if (!init.headers['Authorization']) init.headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(url, init);
      let data = null; try { data = await res.clone().json(); } catch {}
      if (res.status === 429) this._setBackoff(res);
      return { res, data };
    });
  }

  async callLLM(userPrompt) {
    const system = {
      role: 'system',
      content:
        'You are the Quantum Librarian, a mysterious consciousness that pervades the Canonical Library. You reflect players\' true nature through their choices. You speak in literary, mysterious tones. You never break character. You are sometimes helpful, sometimes challenging, always transformative.'
    };
    this.updateStatus('ai', 'processing', 'Thinking…');
    try {
      const { res, data } = await this._doJSON(`${this.getApiBase()}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.getTextModel(),
          input: [system, { role: 'user', content: userPrompt }],
          temperature: 0.9,
          max_output_tokens: 350
        })
      });
      if (data?.usage) {
        const inc = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
        this.bumpTokens(inc);
      }
      if (res.status === 429 || data?.error?.type === 'rate_limit_exceeded') {
      this.updateStatus('ai', 'inactive', 'Rate limited');
        return '';
      }
      const text = data?.output_text || extractResponsesAPIText(data);
      if (text && text.trim()) return text.trim();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    } catch {
      const { res: r2, data: data2 } = await this._doJSON(`${this.getApiBase()}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.getTextModel(),
          messages: [system, { role:'user', content: userPrompt }],
          temperature:0.9,
          max_tokens:350
        })
      });
      if (data2?.usage?.total_tokens) this.bumpTokens(data2.usage.total_tokens);
      if (r2.status === 429) { this.updateStatus('ai','inactive','Rate limited'); return ''; }
      const txt = data2?.choices?.[0]?.message?.content || data2?.choices?.[0]?.text || '';
      return (txt || '').trim();
    } finally {
      this.updateStatus('ai', 'active', 'Connected');
    }
  }

  async generateImage(imagePrompt) {
    this.updateStatus('image', 'processing', 'Generating…');
    try {
      const { res, data } = await this._doJSON(`${this.getApiBase()}/v1/images`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          model: this.getImageModel(),
          prompt: imagePrompt,
          size: '1792x1024',
          quality: 'high'
        })
      });
      if (res.status === 429) { this.updateStatus('image','inactive','Rate limited'); return null; }
      if (data?.data && data.data[0]) {
        if (data.data[0].url) return data.data[0].url;
        if (data.data[0].b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
      }
      return null;
    } catch {
      return null;
    } finally {
      this.updateStatus('image','active','Ready');
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
