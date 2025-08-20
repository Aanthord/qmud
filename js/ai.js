// js/ai.js
// AI client handling both LLM and image generation with proper model routing and auth caching

export class AIClient {
  constructor(
    getApiKey,
    getTextModel,
    getImageModel,
    onTokens,
    onStatus,
    getApiBase
  ) {
    this.getApiKey = getApiKey;
    this.getTextModel = getTextModel;
    this.getImageModel = getImageModel;
    this.onTokens = onTokens;
    this.onStatus = onStatus;
    this.getApiBase = getApiBase;
    
    // Rate limiting
    this.lastImageGenTime = 0;
    this.imageGenMinInterval = 3000; // 3 seconds between image requests to avoid 429
    this.lastLLMTime = 0;
    this.llmMinInterval = 1000; // 1 second between LLM requests
    
    // Auth caching
    this._cachedApiKey = null;
    this._cachedAuthHeader = null;
    this._cachedBase = null;
    
    // Request queue to prevent concurrent requests
    this._requestInFlight = false;
    this._requestQueue = [];
  }

  /**
   * Get cached authorization header to avoid recreating it constantly
   */
  getAuthHeader() {
    const currentKey = this.getApiKey();
    
    // Only recreate if key changed
    if (currentKey !== this._cachedApiKey) {
      this._cachedApiKey = currentKey;
      this._cachedAuthHeader = currentKey ? `Bearer ${currentKey}` : null;
    }
    
    return this._cachedAuthHeader;
  }

  /**
   * Get cached API base URL
   */
  getCachedBase() {
    const currentBase = this.getApiBase() || 'https://api.openai.com';
    
    if (currentBase !== this._cachedBase) {
      this._cachedBase = currentBase;
    }
    
    return this._cachedBase;
  }

  /**
   * Queue management to prevent request storms
   */
  async executeWithQueue(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        if (this._requestInFlight) {
          // Queue this request
          this._requestQueue.push(execute);
          return;
        }
        
        this._requestInFlight = true;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this._requestInFlight = false;
          
          // Process next queued request after a small delay
          if (this._requestQueue.length > 0) {
            const next = this._requestQueue.shift();
            setTimeout(next, 100); // 100ms between queued requests
          }
        }
      };
      
      execute();
    });
  }

  /**
   * Call the LLM for text generation
   */
  async callLLM(prompt, options = {}) {
    const authHeader = this.getAuthHeader();
    const base = this.getCachedBase();
    
    if (!authHeader) {
      console.error('No API key available');
      return null;
    }

    // Rate limiting for LLM
    const now = Date.now();
    const timeSinceLastLLM = now - this.lastLLMTime;
    if (timeSinceLastLLM < this.llmMinInterval) {
      const waitTime = this.llmMinInterval - timeSinceLastLLM;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    return this.executeWithQueue(async () => {
      this.lastLLMTime = Date.now();
      this.onStatus('ai', 'processing', 'Thinking...');
      
      try {
        const messages = [
          { role: 'system', content: 'You are the Quantum Librarian, a mysterious entity that guides seekers through a metaphysical library.' },
          { role: 'user', content: prompt }
        ];

        const response = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify({
            model: this.getTextModel(),
            messages,
            temperature: options.temperature || 0.9,
            max_tokens: options.max_tokens || 500,
            top_p: options.top_p || 0.95,
            frequency_penalty: options.frequency_penalty || 0.3,
            presence_penalty: options.presence_penalty || 0.3
          })
        });

        if (!response.ok) {
          const error = await response.text();
          console.error('LLM API error:', response.status, error);
          
          if (response.status === 429) {
            this.onStatus('ai', 'error', 'Rate limited - slowing down');
            // Increase rate limit interval
            this.llmMinInterval = Math.min(this.llmMinInterval * 1.5, 10000);
          } else if (response.status === 401) {
            // Clear cached auth on 401
            this._cachedApiKey = null;
            this._cachedAuthHeader = null;
            this.onStatus('ai', 'error', 'Auth failed');
          } else {
            this.onStatus('ai', 'error', `Error ${response.status}`);
          }
          return null;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const tokens = data.usage?.total_tokens || 0;
        
        this.onTokens(tokens);
        this.onStatus('ai', 'active', 'Connected');
        
        // Successful request, can reduce rate limit interval
        this.llmMinInterval = Math.max(1000, this.llmMinInterval * 0.9);
        
        return content;
      } catch (error) {
        console.error('LLM call failed:', error);
        this.onStatus('ai', 'error', 'Failed');
        return null;
      }
    });
  }

  /**
   * Generate an image using the appropriate API based on model
   */
  async generateImage(prompt, options = {}) {
    const authHeader = this.getAuthHeader();
    const base = this.getCachedBase();
    
    if (!authHeader) {
      console.error('No API key available');
      return null;
    }

    // Rate limiting to avoid 429
    const now = Date.now();
    const timeSinceLastGen = now - this.lastImageGenTime;
    if (timeSinceLastGen < this.imageGenMinInterval) {
      const waitTime = this.imageGenMinInterval - timeSinceLastGen;
      console.log(`Rate limiting: waiting ${waitTime}ms before image generation`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    return this.executeWithQueue(async () => {
      this.lastImageGenTime = Date.now();
      this.onStatus('image', 'processing', 'Generating...');

      try {
        const model = this.getImageModel();
        
        // For gpt-image-1, we need to use the Responses API
        if (model === 'gpt-image-1') {
          return await this.generateImageWithResponsesAPI(prompt, options, authHeader, base);
        } else {
          // For DALL-E models, use the traditional Image API
          return await this.generateImageWithImageAPI(prompt, options, authHeader, base, model);
        }
      } catch (error) {
        console.error('Image generation failed:', error);
        this.onStatus('image', 'error', 'Failed');
        return null;
      }
    });
  }

  /**
   * Generate image using the Image API (DALL-E 2/3)
   */
  async generateImageWithImageAPI(prompt, options, authHeader, base, model) {
    const response = await fetch(`${base}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        model: model || 'dall-e-3',
        prompt,
        n: 1,
        size: options.size || '1024x1024',
        quality: options.quality || 'standard',
        response_format: 'b64_json'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Image API error:', response.status, error);
      
      if (response.status === 429) {
        this.onStatus('image', 'error', 'Rate limited - wait a moment');
        // Increase rate limit interval
        this.imageGenMinInterval = Math.min(this.imageGenMinInterval * 1.5, 30000);
      } else if (response.status === 401) {
        // Clear cached auth on 401
        this._cachedApiKey = null;
        this._cachedAuthHeader = null;
        this.onStatus('image', 'error', 'Auth failed');
      } else {
        this.onStatus('image', 'error', `Error ${response.status}`);
      }
      return null;
    }

    const data = await response.json();
    const imageData = data.data?.[0]?.b64_json;
    
    if (imageData) {
      const url = `data:image/png;base64,${imageData}`;
      this.onStatus('image', 'active', 'Ready');
      
      // Successful request, can reduce rate limit interval
      this.imageGenMinInterval = Math.max(3000, this.imageGenMinInterval * 0.9);
      
      return url;
    }
    
    return null;
  }

  /**
   * Generate image using the Responses API (GPT-Image-1)
   * Note: This requires a different approach and may need the gpt-4o or gpt-5 model
   */
  async generateImageWithResponsesAPI(prompt, options, authHeader, base) {
    // Since gpt-image-1 requires the Responses API with a mainline model like gpt-4o or gpt-5,
    // we'll fall back to DALL-E 3 for now unless you have access to those models
    
    console.warn('gpt-image-1 requires Responses API with gpt-4o/gpt-5. Falling back to DALL-E 3.');
    
    // Fallback to DALL-E 3
    return await this.generateImageWithImageAPI(prompt, options, authHeader, base, 'dall-e-3');
    
    /* 
    // This is how you would use the Responses API if you have access to gpt-4o or gpt-5:
    
    const response = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        model: 'gpt-4o', // or 'gpt-5' if available
        input: prompt,
        tools: [{
          type: 'image_generation',
          quality: options.quality || 'medium',
          size: options.size || '1024x1024',
          background: options.background || 'auto'
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Responses API error:', response.status, error);
      
      if (response.status === 429) {
        this.onStatus('image', 'error', 'Rate limited');
        this.imageGenMinInterval = Math.min(this.imageGenMinInterval * 1.5, 30000);
      } else if (response.status === 401) {
        this._cachedApiKey = null;
        this._cachedAuthHeader = null;
        this.onStatus('image', 'error', 'Auth failed');
      } else {
        this.onStatus('image', 'error', `Error ${response.status}`);
      }
      return null;
    }

    const data = await response.json();
    
    // Extract image from response output
    const imageOutput = data.output?.find(o => o.type === 'image_generation_call');
    if (imageOutput?.result) {
      const url = `data:image/png;base64,${imageOutput.result}`;
      this.onStatus('image', 'active', 'Ready');
      this.imageGenMinInterval = Math.max(3000, this.imageGenMinInterval * 0.9);
      return url;
    }
    
    return null;
    */
  }
  
  /**
   * Clear all caches (useful when switching API keys or bases)
   */
  clearCache() {
    this._cachedApiKey = null;
    this._cachedAuthHeader = null;
    this._cachedBase = null;
  }
}