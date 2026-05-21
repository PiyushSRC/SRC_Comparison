import React, { useState, useMemo, useEffect } from 'react';
import { Upload, FileText, Settings, Activity, FileDown, LayoutDashboard, BarChart, Table, AlertCircle } from 'lucide-react';
import { parseCSV, getAvailableParameters, performComparison, downloadCSV } from './utils';
import { ProcessedData, AnalysisSummary, ComparisonCategory } from './types';

import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { useVirtualizer } from '@tanstack/react-virtual';

// Custom hook for debouncing values to prevent lag during rapid inputs
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

// Initialize Web Worker globally so it persists
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

// Lazy load ChartComponent for code splitting and better performance
const ChartComponent = React.lazy(() => import('./ChartComponent'));

function App() {
  const [data, setData] = useState<ProcessedData | null>(() => {
    const saved = sessionStorage.getItem('hema_csv_content');
    if (saved) {
      try {
        return parseCSV(saved);
      } catch (e) {
        console.error('Failed to parse saved CSV from session storage:', e);
      }
    }
    return null;
  });
  const [fileName, setFileName] = useState<string>(() => {
    return sessionStorage.getItem('hema_file_name') || '';
  });
  const [selectedParam, setSelectedParam] = useState<string>(() => {
    return sessionStorage.getItem('hema_selected_param') || '';
  });
  const [threshold, setThreshold] = useState<number>(() => {
    const saved = sessionStorage.getItem('hema_threshold');
    return saved ? Number(saved) : 20;
  });
  const [selectedSuffix, setSelectedSuffix] = useState<string>(() => {
    return sessionStorage.getItem('hema_selected_suffix') || '';
  });
  const [step, setStep] = useState<number>(() => {
    const saved = sessionStorage.getItem('hema_step');
    return saved ? Number(saved) : 1;
  });
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isProcessingMath, setIsProcessingMath] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [activeTab, setActiveTab] = useState<'detail' | 'report' | 'matrix'>(() => {
    const saved = sessionStorage.getItem('hema_active_tab');
    if (saved === 'detail' || saved === 'report' || saved === 'matrix') {
      return saved;
    }
    return 'detail';
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [allParamsAnalysis, setAllParamsAnalysis] = useState<any[]>([]);
  const [statusMatrix, setStatusMatrix] = useState<any[]>([]);
  
  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  // Setup Web Worker listener
  useEffect(() => {
    worker.onmessage = (e) => {
      if (e.data.type === 'CALCULATION_COMPLETE') {
        setAllParamsAnalysis(e.data.payload.allParamsAnalysis);
        setStatusMatrix(e.data.payload.statusMatrix);
        setIsProcessingMath(false);
      }
    };
  }, []);

  // Debounce the threshold to prevent lagging when typing
  const debouncedThreshold = useDebounce(threshold, 400);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = event.target.files?.[0];
    if (file) {
      // Gracefully prevent PDF upload with helpful instructions
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMessage('PDF files are document exports and do not contain structured data that can be parsed directly. Please export your analyzer run as an Excel (.xlsx/.xls) or CSV/Text (.csv/.txt) file instead.');
        event.target.value = '';
        return;
      }

      try {
        let text = '';
        if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          text = XLSX.utils.sheet_to_csv(worksheet);
        } else {
          text = await file.text();
        }
        
        const parsed = parseCSV(text);
        if (parsed.records.length > 0) {
          try {
            sessionStorage.setItem('hema_csv_content', text);
            sessionStorage.setItem('hema_file_name', file.name);
          } catch (e) {
            console.warn('Session storage quota exceeded. Auto-restore disabled.', e);
          }
          setFileName(file.name);
          setData(parsed);
          
          const params = getAvailableParameters(parsed.headers);
          if (params.length > 0) {
            const defaultParam = params.find(p => p.startsWith('WBC') || p.startsWith('RBC')) || params[0];
            setSelectedParam(defaultParam);
          }
          
          if (parsed.availableSuffixes.length > 0) {
            setSelectedSuffix(parsed.availableSuffixes[0]);
          }

          setStep(2);
        } else {
          setErrorMessage('No valid records found. Please check that the file is not empty and has a column header for Sample ID (e.g., "Sample ID", "ID", "Sample No").');
        }
      } catch (error) {
        console.error(error);
        setErrorMessage('Error reading file. Ensure it is a valid, uncorrupted CSV or Excel file.');
      } finally {
        // Reset file input value to allow uploading the same file multiple times
        event.target.value = '';
      }
    }
  };

  const parameters = useMemo(() => data ? getAvailableParameters(data.headers) : [], [data]);

  // Trigger Web Worker when data, selectedSuffix, or threshold changes
  useEffect(() => {
    if (!data || !selectedSuffix) return;
    setIsProcessingMath(true);
    
    worker.postMessage({
      type: 'CALCULATE_MATH',
      payload: {
        records: data.records,
        parameters,
        selectedSuffix,
        threshold: debouncedThreshold
      }
    });
  }, [data, selectedSuffix, debouncedThreshold, parameters]);

  // Synchronize selectedParam and selectedSuffix when parameters or suffixes change
  useEffect(() => {
    if (parameters.length > 0 && !parameters.includes(selectedParam)) {
      const defaultParam = parameters.find(p => p.startsWith('WBC') || p.startsWith('RBC')) || parameters[0];
      setSelectedParam(defaultParam);
    }
  }, [parameters, selectedParam]);

  useEffect(() => {
    if (data && data.availableSuffixes.length > 0 && !data.availableSuffixes.includes(selectedSuffix)) {
      setSelectedSuffix(data.availableSuffixes[0]);
    }
  }, [data, selectedSuffix]);

  // Synchronize state changes to sessionStorage
  useEffect(() => {
    if (data) {
      sessionStorage.setItem('hema_step', String(step));
      sessionStorage.setItem('hema_threshold', String(threshold));
      sessionStorage.setItem('hema_selected_suffix', selectedSuffix);
      sessionStorage.setItem('hema_selected_param', selectedParam);
      sessionStorage.setItem('hema_active_tab', activeTab);
    } else {
      sessionStorage.removeItem('hema_csv_content');
      sessionStorage.removeItem('hema_file_name');
      sessionStorage.removeItem('hema_step');
      sessionStorage.removeItem('hema_threshold');
      sessionStorage.removeItem('hema_selected_suffix');
      sessionStorage.removeItem('hema_selected_param');
      sessionStorage.removeItem('hema_active_tab');
    }
  }, [data, step, threshold, selectedSuffix, selectedParam, activeTab]);

  // Selected Parameter Analysis
  const selectedParamAnalysis: AnalysisSummary | null = useMemo(() => {
    if (!allParamsAnalysis || allParamsAnalysis.length === 0 || !selectedParam) return null;
    
    const match = allParamsAnalysis.find(a => a.parameter === selectedParam);
    if (!match) return null;
    
    return {
      parameter: selectedParam,
      threshold: debouncedThreshold,
      results: match.results,
      lows: match.results.filter((r: any) => r.category === ComparisonCategory.LOW),
      normals: match.results.filter((r: any) => r.category === ComparisonCategory.NORMAL),
      highs: match.results.filter((r: any) => r.category === ComparisonCategory.HIGH),
    };
  }, [allParamsAnalysis, selectedParam, debouncedThreshold]);

  const handleDownload = (category: 'LOW' | 'NORMAL' | 'HIGH' | 'ALL') => {
    if (!selectedParamAnalysis) return;
    let dataToExport = [];
    let filename = '';

    switch(category) {
      case 'LOW':
        dataToExport = selectedParamAnalysis.lows;
        filename = `Report_Below_Threshold_${selectedParam}.csv`;
        break;
      case 'NORMAL':
        dataToExport = selectedParamAnalysis.normals;
        filename = `Report_Normal_Range_${selectedParam}.csv`;
        break;
      case 'HIGH':
        dataToExport = selectedParamAnalysis.highs;
        filename = `Report_Above_Threshold_${selectedParam}.csv`;
        break;
      case 'ALL':
        dataToExport = selectedParamAnalysis.results;
        filename = `Report_All_Variations_${selectedParam}.csv`;
        break;
    }
    
    downloadCSV(dataToExport, filename, threshold);
  };

  const handleDownloadPDF = async () => {
    if (!allParamsAnalysis || allParamsAnalysis.length === 0) {
      alert("No data available to print.");
      return;
    }
    setIsGeneratingPDF(true);
    setProgressText('Initializing...');

    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
      const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm
      
      // Margins for "Punching and Piling"
      const gutter = 25; // Left margin for holes
      const rightMargin = 10;
      const topMargin = 15;
      const contentWidth = pageWidth - gutter - rightMargin;
      
      let currentY = topMargin;

      // 1. Draw Native Header (Select logo from the DOM to render natively)
      setProgressText('Generating report header...');
      const logoImg = document.querySelector('.pdf-report-header img') as HTMLImageElement | null;
      if (logoImg && logoImg.complete) {
        const logoWidth = 25;
        const logoHeight = (logoImg.naturalHeight * logoWidth) / logoImg.naturalWidth;
        const logoX = gutter + (contentWidth - logoWidth) / 2;
        pdf.addImage(logoImg, 'PNG', logoX, currentY, logoWidth, logoHeight);
        currentY += logoHeight + 6;
      }

      pdf.setFont('Helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(17, 24, 39); // text-gray-900
      pdf.text("Hematology Comparison Report", gutter + contentWidth / 2, currentY, { align: 'center' });
      currentY += 7;

      pdf.setFont('Helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.setTextColor(75, 85, 99); // text-gray-600
      pdf.text(`Comparison: P(x) vs P(x)-${selectedSuffix}      |      Threshold: ±${debouncedThreshold}%`, gutter + contentWidth / 2, currentY, { align: 'center' });
      currentY += 7;

      pdf.setDrawColor(229, 231, 235); // gray-200
      pdf.setLineWidth(0.5);
      pdf.line(gutter, currentY, gutter + contentWidth, currentY);
      currentY += 8;

      // 2. Add Each Chart Individually
      for (let i = 0; i < allParamsAnalysis.length; i++) {
        const { parameter, results } = allParamsAnalysis[i];
        setProgressText(`Processing graph ${i + 1} of ${allParamsAnalysis.length}...`);
        
        // Wait a tiny frame to allow DOM rendering state sync if needed
        await new Promise(resolve => setTimeout(resolve, 30));

        const chartEl = document.querySelector(`[data-parameter="${parameter}"]`) as HTMLElement | null;
        if (!chartEl) continue;

        const canvasEl = chartEl.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvasEl) continue;

        const chartDataUrl = canvasEl.toDataURL('image/png');

        // Calculate counts
        const lowCount = results.filter((r: any) => r.category === ComparisonCategory.LOW).length;
        const normalCount = results.filter((r: any) => r.category === ComparisonCategory.NORMAL).length;
        const highCount = results.filter((r: any) => r.category === ComparisonCategory.HIGH).length;

        const sectionHeight = 65; // Height of chart section in mm

        // Page break logic (leaves room for footer)
        if (currentY + sectionHeight > pageHeight - 17) {
          pdf.addPage();
          currentY = topMargin + 8; // Leave room for running header on page 2+
        }

        // Draw parameter indicator strip
        pdf.setFillColor(37, 99, 235); // bg-blue-600
        pdf.rect(gutter, currentY, 1.5, 6, 'F');

        // Draw parameter label
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(10.5);
        pdf.setTextColor(31, 41, 55); // text-gray-800
        pdf.text(parameter, gutter + 4, currentY + 4.5);

        // Draw pills
        let pillX = gutter + contentWidth - 70;
        const pillY = currentY + 0.5;
        const pillH = 4.5;
        const textOffset = 3.2;

        // High count (Red)
        pdf.setFillColor(254, 226, 226); // bg-red-100
        pdf.rect(pillX, pillY, 20, pillH, 'F');
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.setTextColor(185, 28, 28); // text-red-700
        pdf.text(`High: ${highCount}`, pillX + 10, pillY + textOffset, { align: 'center' });

        // Normal count (Green)
        pillX += 22;
        pdf.setFillColor(220, 252, 231); // bg-green-100
        pdf.rect(pillX, pillY, 22, pillH, 'F');
        pdf.setTextColor(21, 128, 61); // text-green-700
        pdf.text(`Normal: ${normalCount}`, pillX + 11, pillY + textOffset, { align: 'center' });

        // Low count (Yellow)
        pillX += 24;
        pdf.setFillColor(254, 243, 199); // bg-amber-100
        pdf.rect(pillX, pillY, 20, pillH, 'F');
        pdf.setTextColor(180, 83, 9); // text-amber-700
        pdf.text(`Low: ${lowCount}`, pillX + 10, pillY + textOffset, { align: 'center' });

        // Add Chart Canvas Image
        pdf.addImage(chartDataUrl, 'PNG', gutter, currentY + 8, contentWidth, sectionHeight - 10);
        
        currentY += sectionHeight + 6;
      }
      
      // 3. Post-Process: Add running headers, footers, and page numbers
      setProgressText('Adding headers and footers...');
      const totalPages = pdf.getNumberOfPages();
      for (let j = 1; j <= totalPages; j++) {
        pdf.setPage(j);
        
        // Running Footer (All pages)
        pdf.setFont('Helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(156, 163, 175); // gray-400
        
        const dateString = new Date().toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        pdf.text(`Generated by SRC_Comparison  |  ${dateString}`, gutter, pageHeight - 10);
        pdf.text(`Page ${j} of ${totalPages}`, gutter + contentWidth, pageHeight - 10, { align: 'right' });
        
        // Running Header (Pages 2+)
        if (j > 1) {
          pdf.setFont('Helvetica', 'normal');
          pdf.setFontSize(8.5);
          pdf.setTextColor(107, 114, 128); // text-gray-500
          pdf.text("Hematology Comparison Report - Detailed Graphs", gutter, 12);
          
          // Subtle horizontal line under the running header
          pdf.setDrawColor(229, 231, 235); // gray-200
          pdf.setLineWidth(0.3);
          pdf.line(gutter, 14, gutter + contentWidth, 14);
        }
      }
      
      setProgressText('Finalizing PDF...');
      pdf.save(`Full_Analysis_Report_P${selectedSuffix}.pdf`);
    } catch (err) {
      console.error("PDF generation failed", err);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setIsGeneratingPDF(false);
      setProgressText('');
    }
  };
  const handleDownloadStatusPDF = async () => {
    if (!statusMatrix || statusMatrix.length === 0) {
      alert("No status matrix data available to print.");
      return;
    }
    setIsGeneratingPDF(true);
    setProgressText('Preparing Matrix PDF...');
    
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      // Landscape A4
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth(); // 297mm
      const pageHeight = pdf.internal.pageSize.getHeight(); // 210mm
      
      // Margins (Gutter for punching - Increased for safety)
      const gutter = 30; 
      const rightMargin = 10;
      const topMargin = 15;
      const bottomMargin = 15;
      const contentWidth = pageWidth - gutter - rightMargin; // 257mm

      // Attempt to load logo from DOM for branding
      const logoImg = document.querySelector('img[alt*="Logo"]') as HTMLImageElement | null;
      
      let logoW = 15;
      let logoH = 0;
      const hasLogo = !!(logoImg && logoImg.complete && logoImg.naturalWidth);
      if (hasLogo) {
        logoH = (logoImg.naturalHeight * logoW) / logoImg.naturalWidth;
        // Limit logo height so it doesn't push the table down too much
        if (logoH > 12) {
          logoH = 12;
          logoW = (logoImg.naturalWidth * logoH) / logoImg.naturalHeight;
        }
      }

      // Title Y coordinate centered vertically next to the logo
      const titleY = hasLogo ? topMargin + logoH / 2 + 1.5 : 20;
      
      // Subtitle elements row Y coordinate, safely placed below the logo/title
      const subtitleY = Math.max(topMargin + logoH, titleY) + 6;
      
      // Divider line Y coordinate
      const dividerY = subtitleY + 4;
      
      // Table Header layout coordinates
      const headerStartY = dividerY + 6;
      const headerHeight = 10;
      const bodyStartY = headerStartY + headerHeight;

      const totalRows = statusMatrix.length;
      const rowHeight = 6; // Comfortable row height in mm
      
      // Rows per page is calculated dynamically based on remaining height
      const rowsPerPage = Math.floor((pageHeight - bottomMargin - bodyStartY) / rowHeight);
      const totalPages = Math.ceil(totalRows / rowsPerPage);

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        setProgressText(`Processing page ${pageNum} of ${totalPages}...`);
        
        if (pageNum > 1) {
          pdf.addPage();
        }

        // Draw branding header
        if (hasLogo) {
          try {
            pdf.addImage(logoImg!, 'PNG', gutter, topMargin, logoW, logoH);
          } catch (e) {
            console.error("Failed to add image to PDF:", e);
          }
        }
        
        // Title (position adjusts based on logo presence)
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(15);
        pdf.setTextColor(17, 24, 39);
        const titleX = hasLogo ? gutter + logoW + 4 : gutter;
        pdf.text("STATUS MATRIX", titleX, titleY);
        
        // Subtitle Info
        pdf.setFont('Helvetica', 'normal');
        pdf.setFontSize(8.5);
        pdf.setTextColor(75, 85, 99);
        pdf.text("Suffix: ", gutter, subtitleY);
        const labelWidth1 = pdf.getTextWidth("Suffix: ");
        
        pdf.setFont('Helvetica', 'bold');
        pdf.setTextColor(17, 24, 39);
        pdf.text(selectedSuffix, gutter + labelWidth1, subtitleY);
        const valWidth1 = pdf.getTextWidth(selectedSuffix);
        
        const threshX = gutter + labelWidth1 + valWidth1 + 10;
        pdf.setFont('Helvetica', 'normal');
        pdf.setTextColor(75, 85, 99);
        pdf.text("Threshold: ", threshX, subtitleY);
        const labelWidth2 = pdf.getTextWidth("Threshold: ");
        
        pdf.setFont('Helvetica', 'bold');
        pdf.setTextColor(17, 24, 39);
        pdf.text(`±${debouncedThreshold}%`, threshX + labelWidth2, subtitleY);
        const valWidth2 = pdf.getTextWidth(`±${debouncedThreshold}%`);

        // Add a clean, color-coded legend to explain shorthand cell values
        const legendX = threshX + labelWidth2 + valWidth2 + 15;
        pdf.setFont('Helvetica', 'normal');
        pdf.setTextColor(107, 114, 128); // text-gray-500
        pdf.text("Legend: ", legendX, subtitleY);
        const legendLabelW = pdf.getTextWidth("Legend: ");

        let currentLegendX = legendX + legendLabelW;
        pdf.setFont('Helvetica', 'bold');
        pdf.setTextColor(185, 28, 28); // Red for High
        pdf.text("H", currentLegendX, subtitleY);
        currentLegendX += pdf.getTextWidth("H");
        pdf.setFont('Helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text(" (High)   ", currentLegendX, subtitleY);
        currentLegendX += pdf.getTextWidth(" (High)   ");

        pdf.setFont('Helvetica', 'bold');
        pdf.setTextColor(21, 128, 61); // Green for Normal
        pdf.text("N", currentLegendX, subtitleY);
        currentLegendX += pdf.getTextWidth("N");
        pdf.setFont('Helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text(" (Normal)   ", currentLegendX, subtitleY);
        currentLegendX += pdf.getTextWidth(" (Normal)   ");

        pdf.setFont('Helvetica', 'bold');
        pdf.setTextColor(180, 83, 9); // Amber for Low
        pdf.text("L", currentLegendX, subtitleY);
        currentLegendX += pdf.getTextWidth("L");
        pdf.setFont('Helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        pdf.text(" (Low)", currentLegendX, subtitleY);

        // Page Indicator (aligned vertically relative to the title)
        const rightAlignX = gutter + contentWidth;
        pdf.setFont('Helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(156, 163, 175);
        pdf.text("PAGE", rightAlignX, titleY - 2.5, { align: 'right' });
        
        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(13);
        pdf.setTextColor(17, 24, 39);
        pdf.text(`${pageNum} / ${totalPages}`, rightAlignX, titleY + 4, { align: 'right' });

        // Divider Line
        pdf.setDrawColor(17, 24, 39);
        pdf.setLineWidth(0.6);
        pdf.line(gutter, dividerY, gutter + contentWidth, dividerY);

        // Table Header
        const headerStartY = dividerY + 6;
        const headerHeight = 10;
        const bodyStartY = headerStartY + headerHeight;

        pdf.setFillColor(243, 244, 246);
        pdf.rect(gutter, headerStartY, contentWidth, headerHeight, 'F');

        // Column widths
        const baseIdWidth = 18;
        const variantIdWidth = 22;
        const paramCount = parameters.length;
        const pColWidth = paramCount > 0 ? (contentWidth - baseIdWidth - variantIdWidth) / paramCount : 0;

        // Adaptive header font size calculation based on column width to prevent overlaps
        let headerFontSize = 7.5;
        let unitFontSize = 6.5;
        if (pColWidth < 10) {
          headerFontSize = 5.5;
          unitFontSize = 4.8;
        } else if (pColWidth < 14) {
          headerFontSize = 6.5;
          unitFontSize = 5.5;
        }

        pdf.setFont('Helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(31, 41, 55);
        pdf.text("Base ID", gutter + 2, headerStartY + 6);
        
        pdf.setTextColor(75, 85, 99);
        pdf.text("Variant ID", gutter + baseIdWidth + 2, headerStartY + 6);

        // Param Headers
        for (let j = 0; j < paramCount; j++) {
          const param = parameters[j];
          const parts = param.split('(');
          const name = parts[0].trim();
          const unit = parts.length > 1 ? `(${parts[1]}` : '';
          const colX = gutter + baseIdWidth + variantIdWidth + j * pColWidth;

          pdf.setFont('Helvetica', 'bold');
          pdf.setFontSize(headerFontSize);
          pdf.setTextColor(17, 24, 39);
          pdf.text(name, colX + pColWidth / 2, headerStartY + 4.5, { align: 'center' });

          if (unit) {
            pdf.setFont('Helvetica', 'normal');
            pdf.setFontSize(unitFontSize);
            pdf.setTextColor(107, 114, 128);
            pdf.text(unit, colX + pColWidth / 2, headerStartY + 8, { align: 'center' });
          }
        }

        // Row Data
        const startIndex = (pageNum - 1) * rowsPerPage;
        const endIndex = Math.min(startIndex + rowsPerPage, totalRows);
        const rowsOnThisPage = endIndex - startIndex;

        for (let i = 0; i < rowsOnThisPage; i++) {
          const rowY = bodyStartY + i * rowHeight;
          const rowData = statusMatrix[startIndex + i];
          const isEven = i % 2 === 0;

          // Zebra bg
          const stripeColor = isEven ? [255, 255, 255] : [249, 250, 251];
          pdf.setFillColor(stripeColor[0], stripeColor[1], stripeColor[2]);
          pdf.rect(gutter, rowY, contentWidth, rowHeight, 'F');

          // Text Base ID
          pdf.setFont('Helvetica', 'bold');
          pdf.setFontSize(7.5);
          pdf.setTextColor(17, 24, 39);
          pdf.text(rowData.baseId, gutter + 2, rowY + 4);

          // Text Variant ID
          pdf.setFont('Helvetica', 'normal');
          pdf.setFontSize(7.5);
          pdf.setTextColor(75, 85, 99);
          pdf.text(rowData.variantId, gutter + baseIdWidth + 2, rowY + 4);

          // Params status
          for (let j = 0; j < paramCount; j++) {
            const param = parameters[j];
            const status = rowData[param];
            const colX = gutter + baseIdWidth + variantIdWidth + j * pColWidth;

            let text = '-';
            let bgFill: [number, number, number] | null = null;
            let textRGB: [number, number, number] = [107, 114, 128];
            let isBold = false;

            if (status === 'NORMAL') {
              text = 'N';
              bgFill = [240, 253, 244];
              textRGB = [21, 128, 61];
              isBold = true;
            } else if (status === 'HIGH') {
              text = 'H';
              bgFill = [254, 242, 242];
              textRGB = [185, 28, 28];
              isBold = true;
            } else if (status === 'LOW') {
              text = 'L';
              bgFill = [254, 243, 199];
              textRGB = [180, 83, 9];
              isBold = true;
            } else {
              textRGB = [209, 213, 219];
            }

            if (bgFill) {
              pdf.setFillColor(bgFill[0], bgFill[1], bgFill[2]);
              pdf.rect(colX, rowY, pColWidth, rowHeight, 'F');
            }

            pdf.setFont('Helvetica', isBold ? 'bold' : 'normal');
            pdf.setFontSize(7.5);
            pdf.setTextColor(textRGB[0], textRGB[1], textRGB[2]);
            pdf.text(text, colX + pColWidth / 2, rowY + 4, { align: 'center' });
          }
        }

        // Draw Table Grid Borders
        const TableBottomY = bodyStartY + rowsOnThisPage * rowHeight;

        // Outer borders and grid lines
        pdf.setDrawColor(209, 213, 219);
        pdf.setLineWidth(0.2);

        // Horizontal lines
        pdf.line(gutter, headerStartY, gutter + contentWidth, headerStartY);
        
        pdf.setDrawColor(156, 163, 175);
        pdf.setLineWidth(0.4);
        pdf.line(gutter, bodyStartY, gutter + contentWidth, bodyStartY);
        
        pdf.setDrawColor(229, 231, 235);
        pdf.setLineWidth(0.15);
        for (let i = 0; i < rowsOnThisPage; i++) {
          pdf.line(gutter, bodyStartY + (i + 1) * rowHeight, gutter + contentWidth, bodyStartY + (i + 1) * rowHeight);
        }

        // Vertical lines
        pdf.setDrawColor(209, 213, 219);
        pdf.setLineWidth(0.25);
        pdf.line(gutter, headerStartY, gutter, TableBottomY);
        pdf.line(gutter + baseIdWidth, headerStartY, gutter + baseIdWidth, TableBottomY);
        pdf.line(gutter + baseIdWidth + variantIdWidth, headerStartY, gutter + baseIdWidth + variantIdWidth, TableBottomY);

        for (let j = 0; j < paramCount; j++) {
          const colX = gutter + baseIdWidth + variantIdWidth + (j + 1) * pColWidth;
          pdf.line(colX, headerStartY, colX, TableBottomY);
        }

        // Running Footer (All landscape pages)
        pdf.setFont('Helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(156, 163, 175); // gray-400
        const dateString = new Date().toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        pdf.text(`Generated by SRC_Comparison  |  ${dateString}`, gutter, pageHeight - 10);
      }

      pdf.save(`Status_Matrix_Report_P${selectedSuffix}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Error generating PDF. Please try again.");
    } finally {
      setIsGeneratingPDF(false);
      setProgressText('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
      {/* Progress Bar Header */}
      {isProcessingMath && (
        <div className="absolute top-0 left-0 w-full h-1 bg-gray-200 z-[100]">
          <div className="h-full bg-blue-600 animate-pulse w-full"></div>
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/src-logo-main.png" alt="SRC Comparison Logo" className="h-10 w-auto rounded-lg" />
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">SRC Comparison</h1>
          </div>
          {step > 1 && (
            <div className="flex items-center gap-3">
              {fileName && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-gray-100 border border-gray-200 rounded-lg text-xs text-gray-600 font-mono max-w-[200px] truncate" title={fileName}>
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {fileName}
                </div>
              )}
              <button 
                onClick={() => { setData(null); setStep(1); setFileName(''); }}
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline font-bold px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-all duration-200"
              >
                Upload New File
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        
        {/* Step 1: Upload */}
        {step === 1 && (
          <div className="max-w-xl mx-auto mt-20">
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload Hematology Data</h2>
              <p className="text-gray-500 mb-8">Select your analyzer export file (CSV or Excel) to begin comparison analysis.</p>
              
              {errorMessage && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2 text-left">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>{errorMessage}</p>
                </div>
              )}

              <label className="block w-full cursor-pointer">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 hover:border-blue-500 hover:bg-blue-50 transition-colors">
                  <span className="text-sm text-gray-500 font-medium">Click to browse or drag file here</span>
                  <input 
                    type="file" 
                    accept=".csv,.txt,.xlsx,.xls" 
                    onChange={handleFileUpload} 
                    className="hidden" 
                  />
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Configuration & Analysis */}
        {step === 2 && data && (
          <div className="space-y-6">
            
            {/* Top Configuration Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
                <Settings className="w-5 h-5 text-gray-500" />
                <h3 className="text-lg font-semibold text-gray-800">Global Configuration</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">Comparison Pair (Base vs Variant)</label>
                  {data.availableSuffixes.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                      {data.availableSuffixes.map(suffix => (
                        <button
                          key={suffix}
                          onClick={() => setSelectedSuffix(suffix)}
                          className={`flex-1 min-w-[120px] py-3 px-4 rounded-lg text-sm font-bold transition-all border ${
                            selectedSuffix === suffix 
                              ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-105' 
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                          }`}
                        >
                          Suffix {suffix} (Standard / SRC)
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-red-500 p-2 bg-red-50 rounded">
                      No matching suffixes found in data.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">
                    Variation Threshold
                  </label>
                  <div className="relative max-w-xs">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-full text-lg font-mono p-3 pr-12 rounded-xl border-2 border-gray-200 bg-white text-gray-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 outline-none shadow-sm transition-all"
                    />
                    <div className="absolute right-0 top-0 bottom-0 flex items-center px-4 bg-gray-50 rounded-r-xl border-l border-gray-200 text-gray-500 font-bold">
                      ± %
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Defines the acceptable range (Normal) for sample variation.
                  </p>
                </div>
              </div>
            </div>

            {/* View Tabs */}
            <div className="flex space-x-1 bg-gray-200/50 p-1 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab('detail')}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'detail'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Detailed Analysis
              </button>
              <button
                onClick={() => setActiveTab('report')}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'report'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                }`}
              >
                <BarChart className="w-4 h-4" />
                Graph Section
              </button>
              <button
                onClick={() => setActiveTab('matrix')}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'matrix'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Table className="w-4 h-4" />
                Status Matrix
              </button>
            </div>

            {/* TAB CONTENT: Detailed Analysis */}
            <div className={`${activeTab === 'detail' ? 'block' : 'hidden'} space-y-6 animate-in fade-in duration-300`}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Parameter Selection & Chart */}
                  <div className="lg:col-span-1 lg:sticky lg:top-24 self-start space-y-6">
                    {/* Big Parameter Selector */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                      <label className="block text-sm font-bold text-gray-700 mb-3">
                        Select Parameter
                      </label>
                      <select 
                        value={selectedParam}
                        onChange={(e) => setSelectedParam(e.target.value)}
                        className="w-full text-lg p-3 rounded-xl border-2 border-gray-200 bg-white text-gray-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 outline-none shadow-sm transition-all cursor-pointer"
                      >
                        {parameters.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <div className="mt-4 text-sm text-gray-500 bg-blue-50 p-3 rounded-lg border border-blue-100">
                        Comparing <span className="font-bold text-blue-700">{selectedParam}</span> with threshold <span className="font-bold text-blue-700">±{threshold}%</span>
                      </div>
                    </div>

                    {/* Single Chart Preview */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 h-80 flex flex-col relative">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-medium text-gray-500">Visual Preview</h4>
                        {!isProcessingMath && selectedParamAnalysis && (
                          <div className="flex gap-1.5 text-[10px] font-bold">
                            <span className="bg-[#fee2e2] text-[#b91c1c] px-2 py-0.5 rounded">High: {selectedParamAnalysis.highs.length}</span>
                            <span className="bg-[#dcfce7] text-[#15803d] px-2 py-0.5 rounded">Normal: {selectedParamAnalysis.normals.length}</span>
                            <span className="bg-[#fef3c7] text-[#b45309] px-2 py-0.5 rounded">Low: {selectedParamAnalysis.lows.length}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 w-full min-h-0 relative">
                        {isProcessingMath ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
                            <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
                            <span className="text-xs text-gray-500 font-medium">Re-calculating...</span>
                          </div>
                        ) : null}
                        {selectedParamAnalysis ? (
                          <React.Suspense fallback={<div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">Loading chart...</div>}>
                            <ChartComponent 
                              data={selectedParamAnalysis.results} 
                              threshold={threshold}
                            />
                          </React.Suspense>
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">No data available</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Detailed Data Table */}
                  <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col relative min-h-[300px]">
                    <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                      <h3 className="text-lg font-semibold text-gray-800">Data Table: {selectedParam}</h3>
                      <button 
                        onClick={() => handleDownload('ALL')}
                        disabled={isProcessingMath || !selectedParamAnalysis}
                        className="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 font-medium disabled:opacity-50"
                      >
                         <FileText className="w-4 h-4" /> Export CSV
                      </button>
                    </div>
                    
                    <div className="overflow-auto max-h-[600px] flex-1 relative">
                      {isProcessingMath && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
                          <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
                          <span className="text-xs text-gray-500 font-medium">Updating data table...</span>
                        </div>
                      )}
                      
                      {selectedParamAnalysis ? (
                        <table className="w-full text-sm text-left">
                          <thead className="bg-gray-100 text-gray-600 font-semibold uppercase text-xs sticky top-0 z-10 shadow-sm">
                            <tr>
                              <th className="px-4 py-3 text-center">Base ID</th>
                              <th className="px-4 py-3 text-center">Variant ID</th>
                              <th className="px-4 py-3 text-right">Base Val</th>
                              <th className="px-4 py-3 text-right">Var Val</th>
                              <th className="px-4 py-3 text-right">Var %</th>
                              <th className="px-4 py-3 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            {selectedParamAnalysis.results.map((row, idx) => (
                              <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                                <td className="px-4 py-3 text-center font-medium text-gray-900">{row.baseId}</td>
                                <td className="px-4 py-3 text-center text-gray-500">{row.variantId}</td>
                                <td className="px-4 py-3 text-right text-gray-900">{row.baseValue}</td>
                                <td className="px-4 py-3 text-right text-gray-900">{row.variantValue}</td>
                                <td className={`px-4 py-3 text-right font-mono font-bold ${
                                  row.category === ComparisonCategory.NORMAL ? 'text-gray-600' :
                                  row.category === ComparisonCategory.LOW ? 'text-amber-600' : 'text-red-600'
                                }`}>
                                  {row.percentageOfBase.toFixed(1)}%
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold
                                    ${row.category === ComparisonCategory.LOW ? 'bg-amber-100 text-amber-700' : ''}
                                    ${row.category === ComparisonCategory.NORMAL ? 'bg-green-100 text-green-700' : ''}
                                    ${row.category === ComparisonCategory.HIGH ? 'bg-red-100 text-red-700' : ''}
                                  `}>
                                    {row.category}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="p-8 text-center text-gray-500">Select a parameter to view data</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

            {/* TAB CONTENT: Status Matrix */}
            <div className={`${activeTab === 'matrix' ? 'block' : 'hidden'} animate-in slide-in-from-bottom-2 duration-300`}>
                <div className="bg-gray-800 text-white p-4 rounded-xl shadow-lg mb-6 flex justify-between items-center sticky top-20 z-20">
                  <div>
                    <h3 className="text-lg font-bold">Status Matrix</h3>
                    <p className="text-gray-300 text-sm">
                      Overview of all parameters and their status per sample.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadStatusPDF}
                    disabled={isGeneratingPDF}
                    className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 text-white px-6 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transform active:scale-95"
                  >
                     {isGeneratingPDF ? "Generating PDF..." : <><FileDown className="w-5 h-5" /> Download Matrix PDF</>}
                  </button>
                </div>

                <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden relative">
                  <div ref={tableContainerRef} className="overflow-auto p-8 max-h-[70vh] relative" id="status-matrix-table">
                     {/* Title for PDF Capture */}
                     <div className="mb-4 flex justify-between items-end border-b pb-2">
                       <div>
                         <h2 className="text-xl font-bold text-gray-900">Parameter Status Matrix</h2>
                         <p className="text-sm text-gray-500">Threshold: ±{debouncedThreshold}%</p>
                       </div>
                     </div>

                     {isProcessingMath && (
                       <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-30">
                         <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                         <span className="text-sm text-gray-500 font-medium">Re-calculating status matrix...</span>
                       </div>
                     )}

                     <table className="w-full text-xs border-collapse">
                       <thead>
                         <tr className="bg-gray-50 border-b-2 border-gray-200">
                           <th className="border border-gray-300 px-2 py-2 text-left sticky left-0 top-0 bg-gray-50 z-30 w-[80px]">Base ID</th>
                           <th className="border border-gray-300 px-2 py-2 text-left w-[100px] text-gray-500 font-normal sticky top-0 bg-gray-50 z-20">Variant ID</th>
                           {parameters.map(param => {
                              const parts = param.split('(');
                              const name = parts[0].trim();
                              const unit = parts.length > 1 ? `(${parts[1]}` : '';
                              return (
                                 <th key={param} className="border border-gray-300 px-2 py-2 text-center align-bottom min-w-[70px] sticky top-0 bg-gray-50 z-20">
                                    <div className="font-bold text-gray-900">{name}</div>
                                    <div className="text-[10px] text-gray-400 font-normal">{unit}</div>
                                 </th>
                              );
                           })}
                         </tr>
                       </thead>
                       <StatusMatrixBody statusMatrix={statusMatrix} parameters={parameters} tableContainerRef={tableContainerRef} />
                     </table>
                  </div>
                </div>
               </div>

            {/* TAB CONTENT: Full Graph Report */}
            <div className={`${activeTab === 'report' ? 'block' : 'hidden'} animate-in slide-in-from-bottom-2 duration-300`}>
                <div className="bg-gray-800 text-white p-4 rounded-xl shadow-lg mb-6 flex justify-between items-center sticky top-20 z-20">
                  <div>
                    <h3 className="text-lg font-bold">Graph Section</h3>
                    <p className="text-gray-300 text-sm">
                      {isGeneratingPDF ? progressText : "All parameters ready for print/export"}
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadPDF}
                    disabled={isGeneratingPDF}
                    className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 text-white px-6 py-3 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transform active:scale-95"
                  >
                    {isGeneratingPDF ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Generating...
                      </span>
                    ) : (
                      <>
                        <FileDown className="w-5 h-5" /> Download Printable Report
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-gray-200 p-8 rounded-xl overflow-auto max-h-[calc(100vh-250px)] relative">
                  {isProcessingMath && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-200/80 z-30">
                      <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                      <span className="text-sm text-gray-500 font-medium">Generating comparison graphs...</span>
                    </div>
                  )}
                  {/* Container for Display - This mirrors the PDF visual style */}
                  <div className="mx-auto max-w-[210mm]">
                    
                    {/* Report Header - Marked for PDF capture */}
                    <div className="pdf-report-header bg-white p-12 mb-6 shadow-md rounded-lg text-center border-b-2 border-gray-100">
                      <div className="flex justify-center mb-6">
                        <img src={`${window.location.origin}/src-logo-main.png`} alt="Company Logo" className="h-12 w-auto rounded-lg" />
                      </div>
                      <h2 className="text-3xl font-bold text-gray-900 leading-normal" style={{ paddingBottom: '16px' }}>
                        Hematology Comparison Report
                      </h2>
                      <div className="flex justify-center items-center text-sm text-gray-500">
                        <span className="bg-gray-100 px-3 py-1.5 rounded" style={{ marginRight: '12px' }}>
                          Comparison: <b>P(x)</b> vs <b>P(x)-{selectedSuffix}</b>
                        </span>
                        <span className="bg-gray-100 px-3 py-1.5 rounded" style={{ marginLeft: '12px' }}>
                          Threshold: <b>±{debouncedThreshold}%</b>
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-6 text-right">Generated by SRC_Comparison</p>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      {allParamsAnalysis.map(({ parameter, results }) => {
                        // Calculate Counts
                        const lowCount = results.filter(r => r.category === ComparisonCategory.LOW).length;
                        const normalCount = results.filter(r => r.category === ComparisonCategory.NORMAL).length;
                        const highCount = results.filter(r => r.category === ComparisonCategory.HIGH).length;

                        return (
                          // Marked each chart section for individual PDF capture
                          <div key={parameter} data-parameter={parameter} className="pdf-chart-section bg-white p-6 rounded-lg shadow-md break-inside-avoid">
                            <div className="flex justify-between items-center mb-4 border-l-4 border-blue-600 pl-3">
                              <h4 className="text-lg font-bold text-gray-800">
                                {parameter}
                              </h4>
                              {/* Count Summary Pills */}
                              <div className="flex gap-2 text-xs font-bold">
                                <span className="bg-[#fee2e2] text-[#b91c1c] px-3 py-1 rounded-md">High: {highCount}</span>
                                <span className="bg-[#dcfce7] text-[#15803d] px-3 py-1 rounded-md">Normal: {normalCount}</span>
                                <span className="bg-[#fef3c7] text-[#b45309] px-3 py-1 rounded-md">Low: {lowCount}</span>
                              </div>
                            </div>
                            
                            <div 
                              className="border border-gray-50 rounded-lg flex items-center justify-center overflow-hidden"
                              style={{ height: isGeneratingPDF ? '256px' : '16rem', width: isGeneratingPDF ? '700px' : '100%' }}
                            >
                              <LazyChartWrapper isGeneratingPDF={isGeneratingPDF}>
                                <React.Suspense fallback={<div className="h-full w-full flex items-center justify-center text-gray-400 text-sm">Loading chart...</div>}>
                                  <ChartComponent 
                                    data={results} 
                                    threshold={debouncedThreshold}
                                    hideTooltipInPdf={isGeneratingPDF}
                                  />
                                </React.Suspense>
                              </LazyChartWrapper>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

          </div>
        )}
      </main>

      {/* Full-screen PDF Generation Overlay */}
      {isGeneratingPDF && (
        <div className="fixed inset-0 z-[100] bg-gray-900/70 flex flex-col items-center justify-center backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full mx-4 transform animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-6"></div>
            <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">Generating PDF</h3>
            <p className="text-gray-600 text-center font-medium">{progressText || "Please wait..."}</p>
            <div className="w-full bg-gray-100 h-2 rounded-full mt-6 overflow-hidden">
              <div className="bg-blue-600 h-full rounded-full animate-pulse w-full"></div>
            </div>
            <p className="text-xs text-gray-400 mt-4 text-center">This may take a minute for large reports.<br/>Please do not close the window.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component to lazy load charts and prevent browser lockup
const LazyChartWrapper = ({ children, isGeneratingPDF }: { children: React.ReactNode, isGeneratingPDF: boolean }) => {
  const [isVisible, setIsVisible] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isGeneratingPDF) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [isGeneratingPDF]);

  return <div ref={ref} className="w-full h-full">{isVisible || isGeneratingPDF ? children : null}</div>;
};

// Sub-component for Status Matrix Body to optimize rendering with Virtualization
const StatusMatrixBody = React.memo(({ statusMatrix, parameters, tableContainerRef }: { statusMatrix: any[], parameters: string[], tableContainerRef: React.RefObject<HTMLDivElement | null> }) => {
  const rowVirtualizer = useVirtualizer({
    count: statusMatrix.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36, // estimated row height in px
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;

  return (
    <tbody>
      {paddingTop > 0 && (
        <tr>
          <td style={{ height: `${paddingTop}px` }} colSpan={parameters.length + 2} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => {
        const row = statusMatrix[virtualRow.index];
        if (!row) return null;
        return (
          <tr key={virtualRow.index} data-index={virtualRow.index} ref={rowVirtualizer.measureElement} className="group hover:bg-gray-50 transition-colors">
            <td className="border border-gray-300 px-2 py-2 font-bold sticky left-0 bg-white group-hover:bg-gray-50 transition-colors z-10 min-w-[80px]">{row.baseId}</td>
            <td className="border border-gray-300 px-2 py-2 text-gray-400 min-w-[100px]">{row.variantId}</td>
            {parameters.map(param => {
              const status = row[param];
              let cellClass = "text-gray-300 italic"; // Default N/A
              if (status === 'NORMAL') cellClass = "bg-[#dcfce7] text-[#15803d] font-bold";
              if (status === 'HIGH') cellClass = "bg-[#fee2e2] text-[#b91c1c] font-bold";
              if (status === 'LOW') cellClass = "bg-[#fef3c7] text-[#b45309] font-bold";

              return (
                <td key={param} className={`border border-gray-300 px-1 py-1 text-center min-w-[70px] ${cellClass}`}>
                  {status}
                </td>
              );
            })}
          </tr>
        );
      })}
      {paddingBottom > 0 && (
        <tr>
          <td style={{ height: `${paddingBottom}px` }} colSpan={parameters.length + 2} />
        </tr>
      )}
    </tbody>
  );
});

export default App;