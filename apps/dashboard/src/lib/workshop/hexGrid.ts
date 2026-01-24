export interface HexCoord {
  q: number;
  r: number;
}

interface CubeCoord {
  x: number;
  y: number;
  z: number;
}

const HEX_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export class HexGrid {
  readonly hexRadius: number;
  readonly spacing: number;
  readonly hexWidth: number;
  readonly hexHeight: number;

  private occupied = new Map<string, string>();
  private sessionToHex = new Map<string, string>();
  private spiralIndex = 0;

  constructor(hexRadius = 10, spacing = 1.1) {
    this.hexRadius = hexRadius;
    this.spacing = spacing;
    this.hexWidth = Math.sqrt(3) * hexRadius * spacing;
    this.hexHeight = 2 * hexRadius * spacing;
  }

  axialToCartesian(hex: HexCoord): { x: number; z: number } {
    const x = this.hexWidth * (hex.q + hex.r / 2);
    const z = this.hexHeight * (3 / 4) * hex.r;
    return { x, z };
  }

  cartesianToAxial(x: number, z: number): { q: number; r: number } {
    const r = z / (this.hexHeight * 0.75);
    const q = x / this.hexWidth - r / 2;
    return { q, r };
  }

  roundToHex(q: number, r: number): HexCoord {
    const cube = this.axialToCube({ q, r });
    let rx = Math.round(cube.x);
    let ry = Math.round(cube.y);
    let rz = Math.round(cube.z);

    const dx = Math.abs(rx - cube.x);
    const dy = Math.abs(ry - cube.y);
    const dz = Math.abs(rz - cube.z);

    if (dx > dy && dx > dz) {
      rx = -ry - rz;
    } else if (dy > dz) {
      ry = -rx - rz;
    } else {
      rz = -rx - ry;
    }

    return this.cubeToAxial({ x: rx, y: ry, z: rz });
  }

  cartesianToHex(x: number, z: number): HexCoord {
    const { q, r } = this.cartesianToAxial(x, z);
    return this.roundToHex(q, r);
  }

  hexKey(hex: HexCoord): string {
    return `${hex.q},${hex.r}`;
  }

  parseHexKey(key: string): HexCoord {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  }

  getNeighbors(hex: HexCoord): HexCoord[] {
    return HEX_DIRECTIONS.map((dir) => ({ q: hex.q + dir.q, r: hex.r + dir.r }));
  }

  distance(a: HexCoord, b: HexCoord): number {
    const cubeA = this.axialToCube(a);
    const cubeB = this.axialToCube(b);
    return Math.max(
      Math.abs(cubeA.x - cubeB.x),
      Math.abs(cubeA.y - cubeB.y),
      Math.abs(cubeA.z - cubeB.z)
    );
  }

  equals(a: HexCoord, b: HexCoord): boolean {
    return a.q === b.q && a.r === b.r;
  }

  getHexesInRadius(center: HexCoord, radius: number): HexCoord[] {
    const results: HexCoord[] = [];
    for (let q = -radius + 1; q < radius; q++) {
      for (
        let r = Math.max(-radius + 1, -q - radius + 1);
        r < Math.min(radius, -q + radius);
        r++
      ) {
        results.push({ q: center.q + q, r: center.r + r });
      }
    }
    return results;
  }

  occupy(hex: HexCoord, sessionId: string): void {
    const key = this.hexKey(hex);
    this.occupied.set(key, sessionId);
    this.sessionToHex.set(sessionId, key);
  }

  release(sessionId: string): void {
    const key = this.sessionToHex.get(sessionId);
    if (key) {
      this.occupied.delete(key);
      this.sessionToHex.delete(sessionId);
    }
  }

  isOccupied(hex: HexCoord): boolean {
    return this.occupied.has(this.hexKey(hex));
  }

  getOccupant(hex: HexCoord): string | null {
    return this.occupied.get(this.hexKey(hex)) || null;
  }

  getHexForSession(sessionId: string): HexCoord | null {
    const key = this.sessionToHex.get(sessionId);
    if (!key) return null;
    return this.parseHexKey(key);
  }

  getNextInSpiral(): HexCoord {
    while (this.spiralIndex < 5000) {
      const coord = this.indexToHexCoord(this.spiralIndex);
      this.spiralIndex += 1;
      if (!this.isOccupied(coord)) {
        return coord;
      }
    }
    return { q: 0, r: 0 };
  }

  peekNextInSpiral(): HexCoord {
    let idx = this.spiralIndex;
    while (idx < 5000) {
      const coord = this.indexToHexCoord(idx);
      if (!this.isOccupied(coord)) {
        return coord;
      }
      idx += 1;
    }
    return { q: 0, r: 0 };
  }

  findNearestFreeFromCartesian(x: number, z: number): HexCoord {
    const center = this.cartesianToHex(x, z);
    if (!this.isOccupied(center)) return center;

    const maxRadius = 8;
    for (let radius = 1; radius <= maxRadius; radius++) {
      const ring = this.getHexesInRadius(center, radius + 1);
      for (const hex of ring) {
        if (!this.isOccupied(hex)) {
          return hex;
        }
      }
    }

    return this.getNextInSpiral();
  }

  private indexToHexCoord(index: number): HexCoord {
    if (index === 0) return { q: 0, r: 0 };

    let layer = 1;
    let count = 1;
    while (count + 6 * layer <= index) {
      count += 6 * layer;
      layer += 1;
    }

    const offset = index - count;
    let q = layer;
    let r = 0;

    const directions: HexCoord[] = [
      { q: 0, r: -1 },
      { q: -1, r: -1 },
      { q: -1, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 1, r: 0 },
    ];

    let steps = offset;
    for (let side = 0; side < 6; side++) {
      const stepCount = Math.min(layer, steps);
      q += directions[side].q * stepCount;
      r += directions[side].r * stepCount;
      steps -= stepCount;
      if (steps === 0) break;
    }

    return { q, r };
  }

  private axialToCube(hex: HexCoord): CubeCoord {
    const x = hex.q;
    const z = hex.r;
    const y = -x - z;
    return { x, y, z };
  }

  private cubeToAxial(cube: CubeCoord): HexCoord {
    return { q: cube.x, r: cube.z };
  }
}
