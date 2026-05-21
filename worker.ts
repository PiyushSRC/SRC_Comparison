import { performComparison } from './utils';

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'CALCULATE_MATH') {
    const { records, parameters, selectedSuffix, threshold } = payload;
    
    let allParamsAnalysis: any[] = [];
    let statusMatrix: any[] = [];
    
    if (parameters.length > 0 && selectedSuffix) {
      allParamsAnalysis = parameters.map((param: string) => ({
        parameter: param,
        results: performComparison(records, param, selectedSuffix, threshold)
      })).filter((item: any) => item.results.length > 0);
      
      // 3. Status Matrix Calculation
      // First detect all valid suffixes in records
      const suffixCounts = new Map<string, number>();
      records.forEach((record: any) => {
        const idValue = String(record.id).trim();
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

      const allBaseIds = new Set<string>();
      records.forEach((record: any) => {
        const id = String(record.id).trim();
        const upperId = id.toUpperCase();
        
        // Filter out variants of any suffix
        let isVariant = false;
        for (const s of allSuffixes) {
          const upperS = s.toUpperCase();
          if (upperId.startsWith(`SRC${upperS}`) || upperId.endsWith(`-${upperS}`)) {
            isVariant = true;
            break;
          }
        }
        if (isVariant) return;
        
        allBaseIds.add(id);
      });

      const sortedBaseIds = Array.from(allBaseIds).sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      
      const indexedAnalysis = allParamsAnalysis.map((analysis: any) => {
        const map = new Map<string, any>();
        analysis.results.forEach((r: any) => map.set(r.baseId, r));
        return { parameter: analysis.parameter, map };
      });

      statusMatrix = sortedBaseIds.map((baseId: string) => {
        const cleanBaseId = baseId.replace(/-/g, '');
        let displayVariantId = `${cleanBaseId}-${selectedSuffix}`; 
        
        const row: any = { baseId, variantId: displayVariantId };
        
        indexedAnalysis.forEach((analysis: any) => {
          const match = analysis.map.get(baseId);
          if (match) {
            row[analysis.parameter] = match.category;
            row.variantId = match.variantId; 
          } else {
            row[analysis.parameter] = 'N/A';
          }
        });
        
        return row;
      });
      
      // Filter empty rows (where no parameter comparisons are available)
      statusMatrix = statusMatrix.filter(row => {
        let validCount = 0;
        parameters.forEach((param: string) => {
          if (row[param] && row[param] !== 'N/A') {
            validCount++;
          }
        });
        return validCount > 0;
      });
    }
    
    self.postMessage({
      type: 'CALCULATION_COMPLETE',
      payload: {
        allParamsAnalysis,
        statusMatrix
      }
    });
  }
};
