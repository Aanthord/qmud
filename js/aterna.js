import { ymd } from './utils.js';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
const isoNow = () => new Date().toISOString();

export const Topics = {
  playerState: (playerId) => `qmud.players.${playerId}.state`,
  playerEvents:(playerId) => `qmud.players.${playerId}.events`,
  roomPresence:(roomId)   => `qmud.rooms.${roomId}.presence`,
  roomChat:    (roomId)   => `qmud.rooms.${roomId}.chat`,
  roomUpdates: (roomId)   => `qmud.rooms.${roomId}.updates`,
  roomCombat:  (roomId)   => `qmud.rooms.${roomId}.combat`,
  bookEvents:  (bookId)   => `qmud.books.${bookId}.events`,
  bookState:   (bookId)   => `qmud.books.${bookId}.state`,
  envTick:                  'qmud.env.tick',
  roomState:  (roomId)   => `qmud.env.rooms.${roomId}.state`,
  trades:                   'qmud.economy.trades',
  auditDaily: (day)      => `qmud.audit.daily.${day}`
};

export class AternaClient {
  constructor(cfg) {
    this.base = (cfg.base || '').replace(/\/$/, '');
    this.token = cfg.token || '';
    this.publishPath = cfg.publishPath || '/api/publish';
    this.subscribePath = cfg.subscribePath || '/api/subscribe';
    this.sender = cfg.sender || 'qmud-client';
    this.version = cfg.version || '1.0';
    this.sseTokenParam = cfg.sseTokenParam || 'token';
    this.sseTokenValue = cfg.sseTokenValue || '';
    this.mirrorAudit = !!cfg.mirrorAudit;
    this._seq = 0;
  }
  get enabled() { return !!this.base; }

  buildMessage(contentData, traceID) {
    const tid = traceID || uuidv4();
    return {
      header: {
        id: uuidv4(),
        trace_id: tid,
        sender: this.sender,
        timestamp: isoNow(),
        version: this.version,
        retries: 0
      },
      content: { data: contentData || {} }
    };
  }

  async publish(topic, contentData, traceID) {
    if (!this.enabled) return { ok: false, status: 0, error: 'Aterna disabled' };
    const url = `${this.base}${this.publishPath}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = this.token;
    const body = { topic, message: this.buildMessage(contentData, traceID) };
    const res = await fetch(url, { method:'POST', headers, body: JSON.stringify(body), keepalive:true });
    let data = null; try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  }

  async publishEvent(topic, {
    event_type, room_id = null, player = null, target = null, payload = null
  }, traceID) {
    const content = {
      event_id: uuidv4(),
      event_type,
      ts: isoNow(),
      room_id,
      player,
      target,
      payload,
      seq: this._seq++
    };
    const primary = await this.publish(topic, content, traceID);
    if (this.mirrorAudit) {
      const day = ymd();
      this.publish(Topics.auditDaily(day), { ...content, topic }, traceID).catch(()=>{});
    }
    return primary;
  }

  subscribe(topic, onEvent, { withCredentials = false, params = {} } = {}) {
    if (!this.enabled) return () => {};
    const u = new URL(`${this.base}${this.subscribePath}`);
    u.searchParams.set('topic', topic);
    u.searchParams.set('sender', this.sender);
    Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
    if (this.sseTokenValue) u.searchParams.set(this.sseTokenParam, this.sseTokenValue);
    const es = new EventSource(u.toString(), { withCredentials });
    es.onmessage = (evt) => { try { onEvent?.(JSON.parse(evt.data)); } catch {} };
    es.onerror = () => { /* auto retry by EventSource */ };
    return () => es.close();
  }
}
