/**
 * U-Flash Signal Processing Utilities
 * Implements concepts from the U-Flash paper:
 * 1. RoI Detection (Scattering aware)
 * 2. Adaptive Thresholding
 * 3. Manchester Encoding (Robustness)
 */

// --- Constants ---
export const PREAMBLE = "11101011"; // Unique bit pattern to mark start of frame
export const SAMPLE_WINDOW = 10; // For adaptive thresholding

// --- Encoding Helpers ---

export const textToBinary = (text: string): string => {
  return text.split('').map(char => {
    return char.charCodeAt(0).toString(2).padStart(8, '0');
  }).join('');
};

export const binaryToText = (binary: string): string => {
  // Ensure we have multiples of 8
  const cleanBinary = binary.slice(0, Math.floor(binary.length / 8) * 8);
  const bytes = cleanBinary.match(/.{1,8}/g) || [];
  return bytes.map(byte => String.fromCharCode(parseInt(byte, 2))).join('');
};

/**
 * Manchester Encoding: 0 -> 01, 1 -> 10
 * Ensures frequent transitions for easier clock recovery and thresholding.
 */
export const manchesterEncode = (bits: string): string => {
  let encoded = "";
  for (const bit of bits) {
    encoded += bit === '0' ? '01' : '10';
  }
  return encoded;
};

// --- Image Processing Helpers ---

interface ROI {
  x: number;
  y: number;
  radius: number;
  brightness: number;
}

/**
 * Detects the Region of Interest (RoI) - the brightest "blob" in the frame.
 * Scattering expands the RoI, so we look for a weighted centroid of bright pixels.
 */
export const detectROI = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): ROI | null => {
  let sumX = 0;
  let sumY = 0;
  let totalBrightness = 0;
  let maxBrightness = 0;

  // Sampling step to improve performance (process every 4th pixel)
  const step = 4; 

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      // Simple luminance
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

      if (brightness > 100) { // Threshold to ignore dark water background
        const weight = Math.pow(brightness, 2); // Square weight to prioritize very bright spots
        sumX += x * weight;
        sumY += y * weight;
        totalBrightness += weight;
        if (brightness > maxBrightness) maxBrightness = brightness;
      }
    }
  }

  if (totalBrightness === 0) return null;

  return {
    x: sumX / totalBrightness,
    y: sumY / totalBrightness,
    radius: Math.sqrt(totalBrightness) / 20, // Rough estimate of size
    brightness: maxBrightness
  };
};

/**
 * Extracts a vertical scanline from the image at the ROI x-coordinate.
 * This simulates reading the Rolling Shutter "stripes".
 */
export const extractVerticalScanline = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  roiX: number
): number[] => {
  const x = Math.floor(roiX);
  const scanline: number[] = [];

  for (let y = 0; y < height; y++) {
    const i = (y * width + x) * 4;
    // Grayscale luminance
    scanline.push((data[i] + data[i + 1] + data[i + 2]) / 3);
  }
  return scanline;
};

/**
 * Adaptive Binarization with Automatic Threshold Learning
 */
export const binarizeSignal = (signal: number[]): number[] => {
  const binary: number[] = [];
  const windowSize = 20;

  // 1. Analyze Signal Statistics (Min, Max, Range)
  let min = 255;
  let max = 0;
  
  for (const val of signal) {
    if (val < min) min = val;
    if (val > max) max = val;
  }
  
  const range = max - min;
  
  // 2. Noise Floor Check
  // If the contrast (range) is too low, it's likely just sensor noise or flat background.
  if (range < 30) { 
     return new Array(signal.length).fill(0);
  }

  // 3. Automatic Offset Calculation
  const adaptiveOffset = range * 0.25;

  for (let i = 0; i < signal.length; i++) {
    // Calculate local average around i
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j < Math.min(signal.length, i + windowSize); j++) {
      sum += signal[j];
      count++;
    }
    const localAvg = sum / count;
    
    // Adaptive threshold: Pixel > Local Average + Adaptive Offset
    binary.push(signal[i] > localAvg + adaptiveOffset ? 1 : 0);
  }
  return binary;
};

/**
 * Decodes the binarized scanline into text.
 * Uses Run-Length Encoding to determine bit width and reconstructs the stream.
 * Returns both the detected character (if any) and the raw bitstream found.
 */
export const decodeScanline = (binarizedLine: number[]): { char: string | null, bits: string } => {
  // 1. Run Length Encoding (RLE)
  // Convert [1,1,1,0,0,1,1,1,1] -> [{val:1, len:3}, {val:0, len:2}, {val:1, len:4}]
  const runs: {val: number, len: number}[] = [];
  if (binarizedLine.length === 0) return { char: null, bits: "" };

  let currentVal = binarizedLine[0];
  let currentLen = 1;

  for (let i = 1; i < binarizedLine.length; i++) {
    if (binarizedLine[i] === currentVal) {
      currentLen++;
    } else {
      runs.push({ val: currentVal, len: currentLen });
      currentVal = binarizedLine[i];
      currentLen = 1;
    }
  }
  runs.push({ val: currentVal, len: currentLen });

  // 2. Clock Recovery (Estimate Bit Width)
  // We ignore only the tiniest runs (likely single‑pixel noise) and keep the rest.
  // This makes the decoder more tolerant to fast rolling‑shutter patterns.
  const MIN_RUN_LENGTH = 1;
  const validRuns = runs.filter(r => r.len > MIN_RUN_LENGTH);

  if (validRuns.length < 3) {
    // Not enough structure to reliably decode a character yet – still expose raw bits.
    const rawBits = runs
      .map(run => run.val.toString().repeat(Math.max(1, run.len)))
      .join("");
    return { char: null, bits: rawBits };
  }

  // Sort by length to find the "short" pulse width (1 bit) vs "long" pulse width (2+ bits)
  const sortedLengths = validRuns.map(r => r.len).sort((a, b) => a - b);
  
  // Heuristic: The lower quartile usually represents single-bit widths in a noisy signal
  const quartileIndex = Math.max(0, Math.floor(sortedLengths.length * 0.25));
  let bitWidth = sortedLengths[quartileIndex];

  // Clamp bit width into a sane range so we don't prematurely discard signals
  if (bitWidth < 1) bitWidth = 1;

  // 3. Reconstruct Bit Stream
  let stream = "";
  for (const run of validRuns) {
    // How many bits is this run?
    const numBits = Math.max(1, Math.round(run.len / bitWidth));
    for (let k = 0; k < numBits; k++) {
      stream += run.val.toString();
    }
  }

  // 4. Packet Search
  // Look for the Preamble (11101011)
  const preambleIndex = stream.indexOf(PREAMBLE);
  
  if (preambleIndex !== -1) {
    // Extract payload after preamble
    const payloadStart = preambleIndex + PREAMBLE.length;
    const payloadBits = stream.substr(payloadStart, 8); // Grab 1 Char

    if (payloadBits.length === 8) {
      const char = binaryToText(payloadBits);
      // Basic ASCII validation (printable chars only)
      if (/^[\x20-\x7E]*$/.test(char)) {
        return { char, bits: stream };
      }
    }
  }

  return { char: null, bits: stream }; 
};