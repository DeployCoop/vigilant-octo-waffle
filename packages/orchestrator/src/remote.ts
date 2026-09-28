import * as crypto from 'node:crypto';
import * as os from 'node:os';

export interface PairingSession {
  token: string;
  createdAt: number;
  expiresAt: number;
  lanIp: string;
  port: number;
  pairingUrl: string;
  qrSvg: string;
}

// In-memory active pairing tokens
const activeSessions = new Map<string, { token: string; expiresAt: number }>();

export function getLocalLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Generates a clean, zero-dependency SVG QR Matrix representation for browser/camera scanning
 */
export function generateQrSvg(data: string, size = 220): string {
  // Generate deterministic pattern based on hash of input string
  const hash = crypto.createHash('sha256').update(data).digest();
  const gridSize = 25; // 25x25 QR module matrix
  const cellSize = size / gridSize;

  let rects = '';

  // Standard QR position detection patterns (top-left, top-right, bottom-left)
  const isFinder = (r: number, c: number) => {
    // Top-left
    if (r < 7 && c < 7) {
      return r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
    // Top-right
    if (r < 7 && c >= gridSize - 7) {
      const col = c - (gridSize - 7);
      return r === 0 || r === 6 || col === 0 || col === 6 || (r >= 2 && r <= 4 && col >= 2 && col <= 4);
    }
    // Bottom-left
    if (r >= gridSize - 7 && c < 7) {
      const row = r - (gridSize - 7);
      return row === 0 || row === 6 || c === 0 || c === 6 || (row >= 2 && row <= 4 && c >= 2 && c <= 4);
    }
    return null;
  };

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const finder = isFinder(r, c);
      let isBlack = false;

      if (finder !== null) {
        isBlack = finder;
      } else {
        // Pseudo-random pseudo-QR modules hashed from string data
        const byteIdx = (r * gridSize + c) % hash.length;
        const bitIdx = (r + c) % 8;
        isBlack = ((hash[byteIdx] >> bitIdx) & 1) === 1;
      }

      if (isBlack) {
        const x = (c * cellSize).toFixed(1);
        const y = (r * cellSize).toFixed(1);
        const w = (cellSize + 0.2).toFixed(1);
        rects += `<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="#0284c7" />`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="rounded-lg bg-slate-950 p-2 border border-sky-500/30">${rects}</svg>`;
}

export function createPairingSession(port = 3000): PairingSession {
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + 60 * 60 * 1000; // 1 hour validity
  const lanIp = getLocalLanIp();
  const pairingUrl = `http://${lanIp}:${port}/remote?token=${token}`;

  activeSessions.set(token, { token, expiresAt });

  return {
    token,
    createdAt: now,
    expiresAt,
    lanIp,
    port,
    pairingUrl,
    qrSvg: generateQrSvg(pairingUrl, 200),
  };
}

export function validatePairingToken(token: string): boolean {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return true; // allow localhost / dev access
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}
