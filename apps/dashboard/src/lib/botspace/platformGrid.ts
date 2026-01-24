export interface PlatformCoord {
  x: number;
  y: number;
}

/**
 * PlatformGrid manages floating rectangular platforms in a grid layout.
 * Unlike hexagonal grids, platforms use a simple XY coordinate system
 * with support for vertical stacking (orbital layers).
 */
export class PlatformGrid {
  readonly platformSize: number;
  readonly spacing: number;
  readonly platformWidth: number;
  readonly platformDepth: number;

  private occupied = new Map<string, string>();
  private sessionToPlatform = new Map<string, string>();
  private spiralIndex = 0;

  constructor(platformSize = 12, spacing = 1.2) {
    this.platformSize = platformSize;
    this.spacing = spacing;
    this.platformWidth = platformSize * spacing;
    this.platformDepth = platformSize * spacing;
  }

  coordToCartesian(coord: PlatformCoord): { x: number; z: number } {
    const x = coord.x * this.platformWidth * 1.8;
    const z = coord.y * this.platformDepth * 1.8;
    return { x, z };
  }

  cartesianToCoord(x: number, z: number): PlatformCoord {
    const px = Math.round(x / (this.platformWidth * 1.8));
    const py = Math.round(z / (this.platformDepth * 1.8));
    return { x: px, y: py };
  }

  coordKey(coord: PlatformCoord): string {
    return `${coord.x},${coord.y}`;
  }

  parseCoordKey(key: string): PlatformCoord {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  }

  getNeighbors(coord: PlatformCoord): PlatformCoord[] {
    return [
      { x: coord.x + 1, y: coord.y },
      { x: coord.x - 1, y: coord.y },
      { x: coord.x, y: coord.y + 1 },
      { x: coord.x, y: coord.y - 1 },
    ];
  }

  distance(a: PlatformCoord, b: PlatformCoord): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  equals(a: PlatformCoord, b: PlatformCoord): boolean {
    return a.x === b.x && a.y === b.y;
  }

  getPlatformsInRadius(center: PlatformCoord, radius: number): PlatformCoord[] {
    const results: PlatformCoord[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          results.push({ x: center.x + dx, y: center.y + dy });
        }
      }
    }
    return results;
  }

  occupy(coord: PlatformCoord, sessionId: string): void {
    const key = this.coordKey(coord);
    this.occupied.set(key, sessionId);
    this.sessionToPlatform.set(sessionId, key);
  }

  release(sessionId: string): void {
    const key = this.sessionToPlatform.get(sessionId);
    if (key) {
      this.occupied.delete(key);
      this.sessionToPlatform.delete(sessionId);
    }
  }

  isOccupied(coord: PlatformCoord): boolean {
    return this.occupied.has(this.coordKey(coord));
  }

  getOccupant(coord: PlatformCoord): string | null {
    return this.occupied.get(this.coordKey(coord)) || null;
  }

  getPlatformForSession(sessionId: string): PlatformCoord | null {
    const key = this.sessionToPlatform.get(sessionId);
    if (!key) return null;
    return this.parseCoordKey(key);
  }

  // Spiral pattern for new platform assignment
  getNextInSpiral(): PlatformCoord {
    while (this.spiralIndex < 5000) {
      const coord = this.indexToCoord(this.spiralIndex);
      this.spiralIndex += 1;
      if (!this.isOccupied(coord)) {
        return coord;
      }
    }
    return { x: 0, y: 0 };
  }

  peekNextInSpiral(): PlatformCoord {
    let idx = this.spiralIndex;
    while (idx < 5000) {
      const coord = this.indexToCoord(idx);
      if (!this.isOccupied(coord)) {
        return coord;
      }
      idx += 1;
    }
    return { x: 0, y: 0 };
  }

  findNearestFreeFromCartesian(x: number, z: number): PlatformCoord {
    const center = this.cartesianToCoord(x, z);
    if (!this.isOccupied(center)) return center;

    const maxRadius = 8;
    for (let radius = 1; radius <= maxRadius; radius++) {
      const platforms = this.getPlatformsInRadius(center, radius);
      for (const platform of platforms) {
        if (!this.isOccupied(platform)) {
          return platform;
        }
      }
    }

    return this.getNextInSpiral();
  }

  // Generate tether connections between platforms
  getTetherConnections(platforms: PlatformCoord[]): Array<[PlatformCoord, PlatformCoord]> {
    const connections: Array<[PlatformCoord, PlatformCoord]> = [];
    const coordSet = new Set(platforms.map(p => this.coordKey(p)));

    for (const platform of platforms) {
      const neighbors = this.getNeighbors(platform);
      for (const neighbor of neighbors) {
        const neighborKey = this.coordKey(neighbor);
        if (coordSet.has(neighborKey)) {
          // Only add connection once (by checking ordering)
          const platformKey = this.coordKey(platform);
          if (platformKey < neighborKey) {
            connections.push([platform, neighbor]);
          }
        }
      }
    }

    return connections;
  }

  private indexToCoord(index: number): PlatformCoord {
    if (index === 0) return { x: 0, y: 0 };

    // Spiral outward from center
    let layer = 1;
    let count = 1;
    while (count + 8 * layer <= index) {
      count += 8 * layer;
      layer += 1;
    }

    const offset = index - count;
    const sideLength = 2 * layer;
    const side = Math.floor(offset / sideLength);
    const pos = offset % sideLength;

    // Start at top-right of layer, go around
    let x = layer;
    let y = -layer + 1 + pos;

    if (side === 0) {
      // Right side going down
      x = layer;
      y = -layer + 1 + pos;
    } else if (side === 1) {
      // Bottom going left
      x = layer - 1 - pos;
      y = layer;
    } else if (side === 2) {
      // Left side going up
      x = -layer;
      y = layer - 1 - pos;
    } else {
      // Top going right
      x = -layer + 1 + pos;
      y = -layer;
    }

    return { x, y };
  }
}
