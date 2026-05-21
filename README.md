# Hematology SRC Comparison & CSV Analyzer

An advanced, interactive React dashboard built to analyze and compare hematology sample records. It isolates base samples from variant suffixes (such as dynamic numeric variations like `-3`, `-4`, `-5`, or `SRC` formats), executes deviation math calculations off-thread using Web Workers, and displays results in tabular, graphical, and matrix formats.

---

## Features

* **High-Performance Processing**: Executes all comparison mathematics in a background Web Worker thread to keep the interface smooth and lag-free even for large datasets.
* **Dynamic Suffix Identification**: Automatically partitions base samples from variant suffixes to prevent cross-suffix collisions.
* **Interactive Views**:
  * **Detailed Analysis**: Shows sample-level values, percentage differences, and deviation statuses (Low, Normal, High) for a selected parameter.
  * **Parameter Distribution Charts**: Interactive charts to visualize sample readings relative to the threshold margin.
  * **Status Matrix**: Displays a comprehensive grid view mapping all base samples and their comparison status across all parameters.
* **Exportable Reports**: Generate and download filtered CSV data or a print-ready PDF containing summarized headers, key metrics, and custom charts.

---

## How to Use

### 1. Upload CSV Data
Click the upload zone or drag and drop a standard hematology CSV file. 
* *Note: The tool automatically detects common Sample ID columns (e.g., "Sample ID", "Patient ID") and filters out noise headers.*

### 2. Configure Parameters & Thresholds
* **Select Suffix**: Choose which suffix variation (e.g., `3`, `4`) you want to compare against the base samples.
* **Select Parameter**: Choose the hematology parameter to analyze (e.g., WBC, RBC, PLT, etc.).
* **Adjust Threshold**: Use the threshold slider to set the tolerance percentage (e.g. ±10%). Samples deviating from the base by more than the threshold will be categorized as **High** (above threshold) or **Low** (below threshold).

### 3. Analyze & Export
* Toggle between the **Detailed Analysis**, **Report Charts**, and **Status Matrix** tabs.
* Download specific filtered subsets (e.g., Below Threshold, Above Threshold) via the **Export CSV** button.
* Click **Print Full PDF** to generate a clean, multi-page, grid-aligned document including running page numbers, margins, and graphs.

---

## Run Locally

### Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)

### Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

3. **Build for production**:
   ```bash
   npm run build
   ```
