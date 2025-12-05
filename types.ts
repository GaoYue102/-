
export interface RegionOfInterest {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridCell {
  id: string;
  level: number; // 1 to 4
  x: number; // Image coordinate
  y: number; // Image coordinate
  width: number;
  height: number;
  score: number; // 0-100
  status: 'pending' | 'ok' | 'defect' | 'analyzing';
}

export interface FinalDefect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MatchResult {
  score: number;
  isMatch: boolean;
  description: string;
}

export interface ImageState {
  file: File | null;
  previewUrl: string | null;
  base64: string | null;
  width: number;
  height: number;
}

export interface TransformState {
  scale: number;
  x: number;
  y: number;
}
