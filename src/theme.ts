export const colors = {
  bg: '#F6F5F2',
  surface: '#FFFFFF',
  track: '#EAE8E3',
  line: '#E2E0DA',
  text: '#16161A',
  muted: '#6E6E76',
  error: '#C2410C',
};

export const radius = { card: 24, bar: 18, pill: 999 };

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

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Mistura duas cores #rrggbb (t de 0 a 1).
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// Texto escuro ou claro, o que tiver mais contraste com o fundo.
export function textOn(hex: string): string {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? colors.text : '#FFFFFF';
}

export const WARM = '#FFB75E';
export const COOL = '#CFE2FF';
export const whiteTone = (temp: number) => (temp < 50 ? mix(WARM, '#FFF6E8', temp / 50) : mix('#FFF6E8', COOL, (temp - 50) / 50));
export const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360].map((h) => hsvToHex(h, 100, 100));
