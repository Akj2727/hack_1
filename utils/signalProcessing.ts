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

  // Calculate average brightness for adaptive thresholding
  let totalBrightnessSum = 0;
  let pixelCount = 0;
  for (let y = 0; y < height; y += step * 2) {
    for (let x = 0; x < width; x += step * 2) {
      const i = (y * width + x) * 4;
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      totalBrightnessSum += brightness;
      pixelCount++;
    }
  }
  const avgBrightness = pixelCount > 0 ? totalBrightnessSum / pixelCount : 0;
  
  // Adaptive threshold: look for pixels significantly brighter than average
  // Lower threshold (50) to catch dimmer light sources, but require at least 1.5x average
  const threshold = Math.max(50, avgBrightness * 1.5);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      // Simple luminance
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

      if (brightness > threshold) {
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
 * Improved version with multiple threshold strategies
 */
export const binarizeSignal = (signal: number[]): number[] => {
  const binary: number[] = [];
  if (signal.length === 0) return binary;
  
  const windowSize = 15;

  // 1. Analyze Signal Statistics (Min, Max, Range, Median)
  let min = 255;
  let max = 0;
  const sorted = [...signal].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  for (const val of signal) {
    if (val < min) min = val;
    if (val > max) max = val;
  }
  
  const range = max - min;
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  
  // 2. Noise Floor Check - more lenient threshold
  if (range < 20) { 
     return new Array(signal.length).fill(0);
  }

  // 3. Use multiple threshold strategies
  // Strategy 1: Global threshold (median-based)
  const globalThreshold = median;
  
  // Strategy 2: Adaptive local threshold
  const adaptiveOffset = Math.max(range * 0.2, 15); // At least 15 units of contrast needed

  for (let i = 0; i < signal.length; i++) {
    // Calculate local average around i
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j < Math.min(signal.length, i + windowSize); j++) {
      sum += signal[j];
      count++;
    }
    const localAvg = sum / count;
    
    // Use the higher of: global threshold or local adaptive threshold
    const threshold = Math.max(globalThreshold, localAvg + adaptiveOffset);
    
    // Binary decision: above threshold = 1, below = 0
    binary.push(signal[i] > threshold ? 1 : 0);
  }
  
  // 4. Post-processing: remove isolated noise pixels
  const cleaned: number[] = [...binary];
  for (let i = 1; i < cleaned.length - 1; i++) {
    // If a pixel is different from both neighbors, it's likely noise
    if (cleaned[i] !== cleaned[i-1] && cleaned[i] !== cleaned[i+1]) {
      // Make it match the previous pixel (smoothing)
      cleaned[i] = cleaned[i-1];
    }
  }
  
  return cleaned;
};

/**
 * Fuzzy preamble matching - allows for some bit errors
 */
const fuzzyPreambleMatch = (stream: string, threshold: number = 0.75): number => {
  const preambleLen = PREAMBLE.length;
  if (stream.length < preambleLen) return -1;
  
  let bestMatch = -1;
  let bestScore = 0;
  
  for (let i = 0; i <= stream.length - preambleLen; i++) {
    let matches = 0;
    for (let j = 0; j < preambleLen; j++) {
      if (stream[i + j] === PREAMBLE[j]) matches++;
    }
    const score = matches / preambleLen;
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = i;
    }
  }
  
  return bestScore >= threshold ? bestMatch : -1;
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

  // Filter out very short runs (noise)
  const MIN_RUN_LENGTH = 2;
  const validRuns = runs.filter(r => r.len >= MIN_RUN_LENGTH);

  if (validRuns.length < 3) {
    // Not enough structure - return raw bits
    const rawBits = runs
      .map(run => run.val.toString().repeat(Math.max(1, Math.min(run.len, 10))))
      .join("");
    return { char: null, bits: rawBits };
  }

  // 2. Improved Clock Recovery - use median of run lengths
  const sortedLengths = validRuns.map(r => r.len).sort((a, b) => a - b);
  const medianIndex = Math.floor(sortedLengths.length / 2);
  let bitWidth = sortedLengths[medianIndex];
  
  // Alternative: use mode (most common length) if available
  const lengthCounts: { [key: number]: number } = {};
  validRuns.forEach(r => {
    lengthCounts[r.len] = (lengthCounts[r.len] || 0) + 1;
  });
  let maxCount = 0;
  let modeLength = bitWidth;
  for (const [len, count] of Object.entries(lengthCounts)) {
    if (count > maxCount) {
      maxCount = count;
      modeLength = parseInt(len);
    }
  }
  
  // Use mode if it's reasonable, otherwise fall back to median
  if (maxCount >= 2 && modeLength >= 2 && modeLength <= 50) {
    bitWidth = modeLength;
  }
  
  // Clamp bit width to reasonable range
  if (bitWidth < 2) bitWidth = 2;
  if (bitWidth > 100) bitWidth = 100;

  // 3. Reconstruct Bit Stream with improved quantization
  let stream = "";
  for (const run of validRuns) {
    // More accurate bit count calculation
    const numBits = Math.max(1, Math.round(run.len / bitWidth));
    // Limit expansion to prevent runaway streams
    const clampedBits = Math.min(numBits, 10);
    for (let k = 0; k < clampedBits; k++) {
      stream += run.val.toString();
    }
  }

  // Limit stream length to prevent memory issues
  if (stream.length > 200) {
    stream = stream.substring(0, 200);
  }

  // 4. Packet Search with fuzzy matching
  let preambleIndex = stream.indexOf(PREAMBLE);
  
  // If exact match fails, try fuzzy matching
  if (preambleIndex === -1) {
    preambleIndex = fuzzyPreambleMatch(stream, 0.7); // 70% match threshold
  }
  
  if (preambleIndex !== -1) {
    // Extract payload after preamble
    const payloadStart = preambleIndex + PREAMBLE.length;
    const payloadBits = stream.substring(payloadStart, payloadStart + 8);

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