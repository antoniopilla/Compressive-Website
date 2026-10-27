/**
 * Visual check for lossy image compression. Measures how far a compressed copy
 * is from the pixels it was made from, so a copy that would look different is
 * never offered.
 *
 * The measure is SSIM (structural similarity, Wang et al. 2004): 1 means
 * identical, and the score falls as brightness, contrast or structure drift.
 * It is computed on 8 × 8 windows placed every 4 px, so half of the windows
 * straddle the 8 × 8 blocks JPEG and WebP encode and catch blocking along
 * their edges. Three scores come out:
 *
 *  - luma:      average brightness similarity over the whole image;
 *  - chroma:    average colour similarity (Cb and Cr), which catches colour
 *               bleeding from chroma subsampling around coloured edges;
 *  - worstArea: the lowest average luma score of any 64 × 64 area, so damage
 *               confined to one region (a banded sky, a face) is not averaged
 *               away by an otherwise clean image.
 *
 * Transparent pixels are composited over mid-grey first, so colour hidden
 * under full transparency does not count and partial transparency counts in
 * proportion to how visible it is.
 *
 * Rows are converted a strip at a time, so memory stays small even for
 * 8000 × 8000 images. Pure functions; unit-tested without a browser.
 */

const WINDOW = 8;
const STEP = 4;
const AREA = 64;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const BACKDROP = 128;

/**
 * @typedef {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} Pixels  RGBA, 4 bytes per pixel.
 * @typedef {{ luma: number, chroma: number, worstArea: number }} Similarity
 */

/** Window origins along one axis: every STEP px, plus one flush with the far edge. */
function windowStarts(length, size) {
  const starts = [];
  for (let start = 0; start + size <= length; start += STEP) starts.push(start);
  const last = length - size;
  if (starts[starts.length - 1] !== last) starts.push(last);
  return starts;
}

/**
 * Converts `rows` rows of RGBA, starting at `y`, into Y, Cb and Cr planes
 * (BT.601, full range) after compositing over the grey backdrop.
 */
function toPlanes(pixels, y, rows, planes) {
  const { data, width } = pixels;
  let offset = y * width * 4;
  for (let index = 0; index < rows * width; index += 1, offset += 4) {
    const alpha = data[offset + 3] / 255;
    const backdrop = BACKDROP * (1 - alpha);
    const r = data[offset] * alpha + backdrop;
    const g = data[offset + 1] * alpha + backdrop;
    const b = data[offset + 2] * alpha + backdrop;
    planes[0][index] = 0.299 * r + 0.587 * g + 0.114 * b;
    planes[1][index] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    planes[2][index] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
}

/** SSIM of one window in one plane pair. */
function windowSsim(reference, candidate, x0, size, stride, count) {
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (let row = 0; row < size; row += 1) {
    let index = row * stride + x0;
    for (let column = 0; column < size; column += 1, index += 1) {
      const x = reference[index];
      const y = candidate[index];
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
    }
  }
  const meanX = sumX / count;
  const meanY = sumY / count;
  const varianceX = sumXX / count - meanX * meanX;
  const varianceY = sumYY / count - meanY * meanY;
  const covariance = sumXY / count - meanX * meanY;
  return (
    ((2 * meanX * meanY + C1) * (2 * covariance + C2)) /
    ((meanX * meanX + meanY * meanY + C1) * (varianceX + varianceY + C2))
  );
}

/**
 * Compares a compressed copy with its reference. Both must be RGBA buffers of
 * the same dimensions.
 *
 * @param {Pixels} reference
 * @param {Pixels} candidate
 * @param {{ throwIfCanceled?: () => void }} [options]
 * @returns {Similarity}
 */
export function measureSimilarity(reference, candidate, options = {}) {
  const { width, height } = reference;
  if (candidate.width !== width || candidate.height !== height) {
    throw new RangeError(`Cannot compare ${width} × ${height} with ${candidate.width} × ${candidate.height}.`);
  }
  if (width === 0 || height === 0) return { luma: 1, chroma: 1, worstArea: 1 };

  // Images smaller than one window are compared as a single window.
  const size = Math.min(WINDOW, width, height);
  const count = size * size;
  const xs = windowStarts(width, size);
  const ys = windowStarts(height, size);
  const areaColumns = Math.ceil(width / AREA);
  const areaSums = new Float64Array(areaColumns * Math.ceil(height / AREA));
  const areaCounts = new Uint32Array(areaSums.length);
  const stripLength = width * size;
  const referencePlanes = [0, 1, 2].map(() => new Float32Array(stripLength));
  const candidatePlanes = [0, 1, 2].map(() => new Float32Array(stripLength));

  let lumaSum = 0;
  let chromaSum = 0;
  let windows = 0;
  for (const y0 of ys) {
    options.throwIfCanceled?.();
    toPlanes(reference, y0, size, referencePlanes);
    toPlanes(candidate, y0, size, candidatePlanes);
    const areaRow = Math.floor(y0 / AREA) * areaColumns;
    for (const x0 of xs) {
      const luma = windowSsim(referencePlanes[0], candidatePlanes[0], x0, size, width, count);
      const blue = windowSsim(referencePlanes[1], candidatePlanes[1], x0, size, width, count);
      const red = windowSsim(referencePlanes[2], candidatePlanes[2], x0, size, width, count);
      lumaSum += luma;
      chromaSum += (blue + red) / 2;
      windows += 1;
      const area = areaRow + Math.floor(x0 / AREA);
      areaSums[area] += luma;
      areaCounts[area] += 1;
    }
  }

  let worstArea = 1;
  for (let area = 0; area < areaSums.length; area += 1) {
    if (areaCounts[area]) worstArea = Math.min(worstArea, areaSums[area] / areaCounts[area]);
  }
  return { luma: lumaSum / windows, chroma: chromaSum / windows, worstArea };
}

/**
 * Whether a copy counts as looking the same as its reference.
 *
 * @param {Similarity} similarity
 * @param {{ luma: number, chroma: number, worstArea: number }} thresholds  Minimum score for each measure.
 */
export function looksTheSame(similarity, thresholds) {
  return (
    similarity.luma >= thresholds.luma &&
    similarity.chroma >= thresholds.chroma &&
    similarity.worstArea >= thresholds.worstArea
  );
}
