import { ComparisonCategory, ComparisonResult, ProcessedData, SampleRecord } from './types';
import Papa from 'papaparse';

// Helper to normalize IDs for comparison (removes hyphens, spaces, case-insensitive)
const normalizeId = (id: string): string => {
  return String(id).trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
};

// Robust CSV Parser
export const parseCSV = (content: string): ProcessedData => {
  // Normalize line endings to single \n and remove BOM
  const cleanContent = content.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Use PapaParse to parse the entire content into a 2D array of strings
  const parsed = Papa.parse<string[]>(cleanContent, {
    skipEmptyLines: true,
  });
  
  const lines = parsed.data;
  if (lines.length < 2) return { headers: [], records: [], availableSuffixes: [] };

  // 1. Locate Header Line
  // We search for a line containing "Sample ID" or other common synonyms to handle garbage lines at top
  let headerIndex = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const rowString = lines[i].join(',').toLowerCase();
    
    // Ignore marker lines
    if (rowString.startsWith('---')) continue;

    // Check if line contains ID keywords
    if (
      rowString.includes('sample id') || 
      rowString.includes('sample_id') || 
      rowString.includes('sampleid') ||
      rowString.includes('sample no') ||
      rowString.includes('sample_no') ||
      rowString.includes('sampleno') ||
      rowString.includes('patient id') ||
      rowString.includes('patient_id') ||
      rowString.includes('patientid') ||
      rowString.includes('sid')
    ) {
      headerIndex = i;
      break;
    }
    // Fallback for simple "ID" column
    if (lines[i].length > 0 && lines[i].some(col => {
      const c = col.toLowerCase().trim();
      return c === 'id' || c === 'sid' || c === 'sample' || c === 'patient';
    })) {
      headerIndex = i;
      break;
    }
  }

  // If no explicit header found, default to first non-empty/non-marker line
  if (headerIndex === -1) {
    headerIndex = lines.findIndex(l => !l.join('').startsWith('---'));
    if (headerIndex === -1) headerIndex = 0;
  }

  headers = lines[headerIndex].map(h => h.trim());

  // Smart ID Column Detection
  let idIndex = headers.findIndex(h => /sample\s*id|sample_id|sampleid/i.test(h));
  if (idIndex === -1) idIndex = headers.findIndex(h => /sample\s*no|sample_no|sampleno/i.test(h));
  if (idIndex === -1) idIndex = headers.findIndex(h => /patient\s*id|patient_id|patientid/i.test(h));
  if (idIndex === -1) idIndex = headers.findIndex(h => /^id$|^sid$/i.test(h));
  if (idIndex === -1) idIndex = headers.findIndex(h => /^sample$|^patient$/i.test(h));
  if (idIndex === -1) idIndex = 0; // Fallback to first column

  const records: SampleRecord[] = [];
  const suffixCounts = new Map<string, number>();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const values = lines[i];
    const rowString = values.join(',').toLowerCase();
    
    // Skip empty lines or marker lines
    if (rowString.startsWith('---')) continue;
    
    // Skip "Background" lines often found in analyzer exports
    if (rowString.includes('background')) continue;

    // Ensure we have enough data to find the ID
    if (values.length <= idIndex) continue;

    const idValue = values[idIndex].trim();
    
    // Skip records without a valid ID
    if (!idValue) continue;

    // DETECT SUFFIX Logic
    if (idValue.includes('-')) {
      const parts = idValue.split('-');
      
      // Check for SRC Format: SRC3-P1 (Suffix is '3')
      const srcMatch = parts[0].match(/^SRC(.+)$/i);
      if (srcMatch && srcMatch[1]) {
        const suffix = srcMatch[1].trim();
        suffixCounts.set(suffix, (suffixCounts.get(suffix) || 0) + 1);
      } else if (parts.length > 1) {
        // Standard Format: P1-3 (Suffix is '3')
        // Potential suffix is the last part
        const potentialSuffix = parts[parts.length - 1];
        if (potentialSuffix && potentialSuffix.trim().length > 0) {
          // Heuristic: A suffix is usually short (1-3 digits)
          // or if it's longer, it should appear frequently.
          suffixCounts.set(potentialSuffix.trim(), (suffixCounts.get(potentialSuffix.trim()) || 0) + 1);
        }
      }
    }
    
    const record: SampleRecord = { id: idValue };
    
    headers.forEach((header, index) => {
      if (index < values.length) {
        record[header] = values[index].trim();
      }
    });

    records.push(record);
  }

  // Filter Suffixes: A valid suffix must appear in at least 2 records
  // This prevents unique IDs like "102" in "P-102" from being treated as a suffix
  const validSuffixes = Array.from(suffixCounts.keys()).filter(suffix => {
    const count = suffixCounts.get(suffix) || 0;
    return count > 1; // Frequency Threshold
  });

  // Sort suffixes numerically if they are numbers, otherwise alphabetically
  const availableSuffixes = validSuffixes.sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return a.localeCompare(b);
  });

  return { headers, records, availableSuffixes };
};

export const getAvailableParameters = (headers: string[]): string[] => {
  // 1. Filter out known metadata/demographic columns
  const excludedPrefixes = [
    'Sample', 'Date', 'Time', 'Patient', 'Gender', 'Ref', 'Dept', 'Bed', 
    'Draw', 'Delivery', 'Clinician', 'Operator', 'Valid', 'Comment', 
    'First', 'Last', 'Mode', 'Age', 'DOB', 'Background', 'Analysis'
  ];
  
  // 2. Implement the Cutoff: Find P-LCR and discard everything after it
  // We search for "P-LCR" case-insensitive and dash/space resilient
  const cutoffIndex = headers.findIndex(h => {
    const norm = h.toUpperCase().replace(/[\s-_]/g, '');
    return norm.includes('PLCR');
  });
  
  let usefulHeaders = headers;
  
  if (cutoffIndex !== -1) {
    // Slice includes the found index, so +1
    usefulHeaders = headers.slice(0, cutoffIndex + 1);
  }

  return usefulHeaders.filter(h => {
    // Remove if it matches excluded list
    if (excludedPrefixes.some(ex => h.startsWith(ex) || h.includes(ex))) return false;
    // Remove columns that contain "Message" (e.g., WBC Message)
    if (h.includes('Message')) return false;
    // Remove empty headers
    if (h.length === 0) return false;
    return true;
  });
};

export const performComparison = (
  records: SampleRecord[], 
  parameter: string, 
  suffix: string, // Dynamic suffix (e.g. "3", "4", "5")
  thresholdPercent: number
): ComparisonResult[] => {
  const results: ComparisonResult[] = [];
  
  const variantMap = new Map<string, SampleRecord>();
  const baseRecords: SampleRecord[] = [];

  // Detect all valid suffixes in records to avoid multi-suffix collisions
  const suffixCounts = new Map<string, number>();
  records.forEach(r => {
    const idValue = String(r.id).trim();
    if (idValue.includes('-')) {
      const parts = idValue.split('-');
      const srcMatch = parts[0].match(/^SRC(.+)$/i);
      if (srcMatch && srcMatch[1]) {
        const suffixVal = srcMatch[1].trim();
        suffixCounts.set(suffixVal, (suffixCounts.get(suffixVal) || 0) + 1);
      } else if (parts.length > 1) {
        const potentialSuffix = parts[parts.length - 1];
        if (potentialSuffix && potentialSuffix.trim().length > 0) {
          suffixCounts.set(potentialSuffix.trim(), (suffixCounts.get(potentialSuffix.trim()) || 0) + 1);
        }
      }
    }
  });
  const allSuffixes = Array.from(suffixCounts.keys()).filter(s => (suffixCounts.get(s) || 0) > 1);

  // Partition records by their suffix mapping to eliminate collisions
  records.forEach(r => {
    const rawId = String(r.id).trim();
    const upperId = rawId.toUpperCase();
    const upperSuffix = suffix.toUpperCase();

    // Check if it's a variant for the active suffix:
    // 1. Starts with SRC{suffix}
    if (upperId.startsWith(`SRC${upperSuffix}`)) {
      let basePart = rawId.slice(3 + suffix.length);
      basePart = basePart.replace(/^[^a-zA-Z0-9]+/, '');
      variantMap.set(normalizeId(basePart), r);
      return;
    } 
    // 2. Ends with -{suffix}
    else if (upperId.endsWith(`-${upperSuffix}`)) {
      const basePart = rawId.slice(0, rawId.length - 1 - suffix.length);
      variantMap.set(normalizeId(basePart), r);
      return;
    } 

    // Check if it is a variant for ANY other valid suffix, to exclude it from baseRecords
    let isOtherVariant = false;
    for (const otherSuffix of allSuffixes) {
      if (otherSuffix.toUpperCase() === upperSuffix) continue;
      const upperOther = otherSuffix.toUpperCase();
      if (upperId.startsWith(`SRC${upperOther}`) || upperId.endsWith(`-${upperOther}`)) {
        isOtherVariant = true;
        break;
      }
    }

    if (!isOtherVariant) {
      baseRecords.push(r);
    }
  });

  // Helper to extract clean float handling flags like "R 1.9" or "H 10.1"
  const extractNumber = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val);
    // Matches numbers that might be preceded by letters (flags) and followed by anything
    // e.g. "R 1.9" -> 1.9, "H 10.1" -> 10.1
    const match = str.match(/[-+]?[0-9]*\.?[0-9]+/);
    if (match) {
      return parseFloat(match[0]);
    }
    return 0;
  };

  // Iterate over candidates as potential Base Samples
  baseRecords.forEach(potentialBase => {
    const baseIdRaw = String(potentialBase.id);
    const baseIdNorm = normalizeId(baseIdRaw);

    // Look up the corresponding variant in the partitioned map
    const variantRecord = variantMap.get(baseIdNorm);

    // If we found a match and it's not the same record
    if (variantRecord && variantRecord.id !== potentialBase.id) {
      const baseVal = extractNumber(potentialBase[parameter]);
      const variantVal = extractNumber(variantRecord[parameter]);

      // Only compare if Base Value is valid and > 0
      if (baseVal > 0) {
        const percentageOfBase = (variantVal / baseVal) * 100;
        
        let category = ComparisonCategory.NORMAL;
        const lowerLimit = 100 - thresholdPercent;
        const upperLimit = 100 + thresholdPercent;

        if (percentageOfBase < lowerLimit) {
          category = ComparisonCategory.LOW;
        } else if (percentageOfBase > upperLimit) {
          category = ComparisonCategory.HIGH;
        }

        // FORCE Standard Output Format: BaseID-Suffix
        // Remove hyphens from Base ID part: P-1 -> P1. Then append suffix -> P1-11
        const cleanBaseId = baseIdRaw.replace(/-/g, '');
        const standardizedVariantId = `${cleanBaseId}-${suffix}`;

        results.push({
          baseId: baseIdRaw,
          variantId: standardizedVariantId, // Use enforced format P(x)-Y
          baseValue: baseVal,
          variantValue: variantVal,
          percentageOfBase,
          category
        });
      }
    }
  });

  // Sort Results Ascending Naturally (P1, P2 ... P10 ... P45)
  results.sort((a, b) => {
    return a.baseId.localeCompare(b.baseId, undefined, { numeric: true, sensitivity: 'base' });
  });

  return results;
};

export const downloadCSV = (data: ComparisonResult[], filename: string, threshold: number) => {
  // Reorder to match Table Structure: Base Sample ID, Variant Sample ID, Base Value, Variant Value
  const headers = [
    "Base Sample ID", 
    "Variant Sample ID", 
    "Base Value",
    "Variant Value", 
    "Percentage of Base (%)", 
    "Analysis Message"
  ];

  const rows = data.map(row => {
    let message = "";
    const lowerLimit = 100 - threshold;
    const upperLimit = 100 + threshold;

    if (row.category === ComparisonCategory.HIGH) {
      // Calculate deviation from the UPPER threshold limit
      const diff = row.percentageOfBase - upperLimit;
      message = `${diff.toFixed(2)}% more compared to the threshold`;
    } else if (row.category === ComparisonCategory.LOW) {
      // Calculate deviation from the LOWER threshold limit
      const diff = lowerLimit - row.percentageOfBase;
      message = `${diff.toFixed(2)}% less than the threshold`;
    } else {
      message = "Within threshold range";
    }

    // Escape message for CSV
    const safeMessage = `"${message}"`;

    return [
      row.baseId,
      row.variantId,
      row.baseValue,
      row.variantValue,
      row.percentageOfBase.toFixed(2),
      safeMessage
    ];
  });

  const csvContent = [
    headers.join(","),
    ...rows.map(r => r.join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};