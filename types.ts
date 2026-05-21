export interface SampleRecord {
  id: string;
  [key: string]: string | number;
}

export interface ProcessedData {
  headers: string[];
  records: SampleRecord[];
  availableSuffixes: string[];
}

export enum ComparisonCategory {
  LOW = 'LOW', // Below (100 - threshold)%
  NORMAL = 'NORMAL', // Between (100 - threshold)% and (100 + threshold)%
  HIGH = 'HIGH', // Above (100 + threshold)%
}

export interface ComparisonResult {
  baseId: string;
  variantId: string;
  baseValue: number;
  variantValue: number;
  percentageOfBase: number; // e.g., 125%
  category: ComparisonCategory;
}

export interface AnalysisSummary {
  parameter: string;
  threshold: number;
  results: ComparisonResult[];
  lows: ComparisonResult[];
  normals: ComparisonResult[];
  highs: ComparisonResult[];
}