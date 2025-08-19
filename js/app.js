// app.js — boot
import { QuantumTruthMUD } from './game.js';

const game = new QuantumTruthMUD();
await game.init();
window.game = game;
