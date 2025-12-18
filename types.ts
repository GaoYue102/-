
export interface RegionOfInterest {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridCell {
  id: string;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  status: 'pending' | 'ok' | 'defect' | 'analyzing' | 'ai_verifying';
  description?: string;
}

export interface FinalDefect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description?: string;
  isAiConfirmed?: boolean;
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
