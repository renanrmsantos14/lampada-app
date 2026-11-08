export const colors = {
  bg: '#111214',
  card: '#1b1d21',
  text: '#f2f2f3',
  muted: '#8b8f98',
  accent: '#ffc94d',
  error: '#ff6b6b',
};

// HSV (h 0–360, s/v 0–100) → #rrggbb, para mostrar a cor atual.
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = (v / 100) * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1)));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}
