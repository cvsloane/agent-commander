export interface DrawColor {
  id: string;
  name: string;
  color: number;
  hex: string;
  key: string;
}

export const DRAW_COLORS: DrawColor[] = [
  { id: 'cyan', name: 'Cyan', color: 0x22d3ee, hex: '#22d3ee', key: '1' },
  { id: 'sky', name: 'Sky', color: 0x38bdf8, hex: '#38bdf8', key: '2' },
  { id: 'blue', name: 'Blue', color: 0x60a5fa, hex: '#60a5fa', key: '3' },
  { id: 'indigo', name: 'Indigo', color: 0x818cf8, hex: '#818cf8', key: '4' },
  { id: 'purple', name: 'Purple', color: 0xa78bfa, hex: '#a78bfa', key: '5' },
  { id: 'teal', name: 'Teal', color: 0x2dd4bf, hex: '#2dd4bf', key: '6' },
];

export const ERASER_KEY = '0';
