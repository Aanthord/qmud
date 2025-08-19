// app.js — boot
import { QuantumTruthMUD } from './game.js';

const game = new QuantumTruthMUD();
await game.init();           // top-level await is supported in ES modules on modern browsers
window.game = game;          // expose for inline onclick attributes
