// utils.js — tiny helpers
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const downloadJSON = (obj, fname) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 350);
};
