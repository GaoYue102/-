
import { GoogleGenAI, Type } from "@google/genai";
import { MatchResult } from "../types";

// Using OpenCV logic for deterministic matching
declare global {
  interface Window {
    cv: any;
  }
}

const loadImage = (base64: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = base64;
  });
};

const waitForOpenCV = async (): Promise<boolean> => {
  let tries = 0;
  while (tries < 50) { // Wait up to 5 seconds
    if (typeof window.cv !== 'undefined' && window.cv.Mat) return true;
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  return false;
};

/**
 * Aligns the Test Image to match the Reference Image's perspective,
 * THEN crops both images to the SAFE INNER RECTANGLE (intersection without black borders).
 */
export const alignAndCropImages = async (
  refBase64: string,
  testBase64: string
): Promise<{ refCropped: string, testCropped: string, width: number, height: number } | null> => {
  const isCvReady = await waitForOpenCV();
  if (!isCvReady) throw new Error("OpenCV not loaded");

  const cv = window.cv;

  try {
    const refImg = await loadImage(refBase64);
    const testImg = await loadImage(testBase64);

    const refMat = cv.imread(refImg);
    const testMat = cv.imread(testImg);

    // --- STEP 1: Feature Detection & Matching ---
    const refGray = new cv.Mat();
    const testGray = new cv.Mat();
    cv.cvtColor(refMat, refGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(testMat, testGray, cv.COLOR_RGBA2GRAY);

    const orb = new cv.ORB(2000); 
    const keypointsRef = new cv.KeyPointVector();
    const keypointsTest = new cv.KeyPointVector();
    const descriptorsRef = new cv.Mat();
    const descriptorsTest = new cv.Mat();

    orb.detectAndCompute(refGray, new cv.Mat(), keypointsRef, descriptorsRef);
    orb.detectAndCompute(testGray, new cv.Mat(), keypointsTest, descriptorsTest);

    const bf = new cv.BFMatcher(cv.NORM_HAMMING, true);
    const matches = new cv.DMatchVector();
    
    // bf.match(query, train) -> query=Ref, train=Test
    bf.match(descriptorsRef, descriptorsTest, matches);

    const matchArray = [];
    for (let i = 0; i < matches.size(); i++) {
      matchArray.push(matches.get(i));
    }
    matchArray.sort((a, b) => a.distance - b.distance);
    
    // Need at least 4 matches for Homography
    const goodMatches = matchArray.slice(0, Math.min(50, Math.max(10, matchArray.length * 0.15)));
    
    let warpedMat = new cv.Mat();
    let useOriginalTest = true;
    let H: any = null;

    if (goodMatches.length >= 4) {
      const srcPoints = new cv.Mat(goodMatches.length, 1, cv.CV_32FC2);
      const dstPoints = new cv.Mat(goodMatches.length, 1, cv.CV_32FC2);

      for (let i = 0; i < goodMatches.length; i++) {
        const matIdx = goodMatches[i]; 
        
        // Correct Index Mapping:
        // queryIdx -> Ref (Destination)
        // trainIdx -> Test (Source)
        const kpTest = keypointsTest.get(matIdx.trainIdx); 
        const kpRef = keypointsRef.get(matIdx.queryIdx);

        srcPoints.data32F[i * 2] = kpTest.pt.x;
        srcPoints.data32F[i * 2 + 1] = kpTest.pt.y;
        
        dstPoints.data32F[i * 2] = kpRef.pt.x;
        dstPoints.data32F[i * 2 + 1] = kpRef.pt.y;
      }

      const mask = new cv.Mat();
      H = cv.findHomography(srcPoints, dstPoints, cv.RANSAC, 5.0, mask);

      if (!H.empty()) {
        const dsize = new cv.Size(refMat.cols, refMat.rows);
        cv.warpPerspective(testMat, warpedMat, H, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0,0,0,0));
        useOriginalTest = false;
      } else {
        console.warn("Homography matrix empty, skipping alignment.");
      }
      
      srcPoints.delete(); dstPoints.delete(); mask.delete();
    }

    if (useOriginalTest) {
       testMat.copyTo(warpedMat);
    }

    // --- STEP 2: Find Safe Intersection (Remove Black Borders) ---
    let cropRect;

    if (!useOriginalTest && H) {
        // Calculate the Inner Inscribed Rectangle
        // Project the corners of the Test Image into the Reference Coordinate System
        let hData = H.data64F; 
        if (!hData && H.data32F) hData = H.data32F;
        
        const transformPoint = (x: number, y: number) => {
             const z = hData[6] * x + hData[7] * y + hData[8];
             const scale = z !== 0 ? 1.0 / z : 1.0;
             const tx = (hData[0] * x + hData[1] * y + hData[2]) * scale;
             const ty = (hData[3] * x + hData[4] * y + hData[5]) * scale;
             return {x: tx, y: ty};
        };

        const corners = [
            transformPoint(0, 0),             // TL
            transformPoint(testMat.cols, 0),  // TR
            transformPoint(testMat.cols, testMat.rows), // BR
            transformPoint(0, testMat.rows)   // BL
        ];

        const refW = refMat.cols;
        const refH = refMat.rows;

        // INNER CROP LOGIC:
        // To exclude black wedges caused by rotation/skew, we must crop inwards.
        // Left: max of left-side corners
        const x1 = Math.max(0, corners[0].x, corners[3].x);
        // Top: max of top-side corners
        const y1 = Math.max(0, corners[0].y, corners[1].y);
        // Right: min of right-side corners (and ref width)
        const x2 = Math.min(refW, corners[1].x, corners[2].x);
        // Bottom: min of bottom-side corners (and ref height)
        const y2 = Math.min(refH, corners[3].y, corners[2].y);

        let cropX = Math.ceil(x1);
        let cropY = Math.ceil(y1);
        let cropW = Math.floor(x2 - cropX);
        let cropH = Math.floor(y2 - cropY);

        // Sanity check: If alignment resulted in extreme warping (e.g. crop area too small), fallback safely.
        if (cropW < 50 || cropH < 50) {
             console.warn("Inner crop too small, falling back to full frame intersection.");
             cropX = 0; cropY = 0;
             cropW = Math.min(refMat.cols, warpedMat.cols);
             cropH = Math.min(refMat.rows, warpedMat.rows);
        }

        cropRect = new cv.Rect(cropX, cropY, cropW, cropH);
        H.delete();

    } else {
        const w = Math.min(refMat.cols, warpedMat.cols);
        const h = Math.min(refMat.rows, warpedMat.rows);
        cropRect = new cv.Rect(0, 0, w, h);
    }

    // --- STEP 3: Crop Both Images ---
    // Ensure bounds safety
    cropRect.x = Math.max(0, Math.min(cropRect.x, refMat.cols - 1));
    cropRect.y = Math.max(0, Math.min(cropRect.y, refMat.rows - 1));
    cropRect.width = Math.max(1, Math.min(cropRect.width, refMat.cols - cropRect.x));
    cropRect.height = Math.max(1, Math.min(cropRect.height, refMat.rows - cropRect.y));
    
    // Check against warpedMat bounds too
    if (cropRect.x + cropRect.width > warpedMat.cols) cropRect.width = warpedMat.cols - cropRect.x;
    if (cropRect.y + cropRect.height > warpedMat.rows) cropRect.height = warpedMat.rows - cropRect.y;

    const finalRef = refMat.roi(cropRect);
    const finalTest = warpedMat.roi(cropRect);

    // Output
    const canvas = document.createElement('canvas');
    
    cv.imshow(canvas, finalRef);
    const refOut = canvas.toDataURL('image/jpeg', 0.9);
    
    cv.imshow(canvas, finalTest);
    const testOut = canvas.toDataURL('image/jpeg', 0.9);

    // Cleanup
    refMat.delete(); testMat.delete(); refGray.delete(); testGray.delete();
    keypointsRef.delete(); keypointsTest.delete(); descriptorsRef.delete(); descriptorsTest.delete();
    matches.delete(); bf.delete(); orb.delete(); warpedMat.delete();
    finalRef.delete(); finalTest.delete();

    return { 
        refCropped: refOut, 
        testCropped: testOut, 
        width: cropRect.width, 
        height: cropRect.height 
    };

  } catch (e) {
    console.error("Alignment/Crop Error:", e);
    return null;
  }
};

/**
 * Compares a specific Reference Template against a Test Search Region.
 * Uses Gaussian Blur to be robust against affine changes and translation.
 */
export const compareRegionPair = async (
  templateBase64: string,
  searchRegionBase64: string
): Promise<number> => {
  
  const isCvReady = await waitForOpenCV();
  if (!isCvReady) return 0;

  const cv = window.cv;

  try {
    const templateImg = await loadImage(templateBase64);
    const searchImg = await loadImage(searchRegionBase64);

    const templateMat = cv.imread(templateImg);
    const searchMat = cv.imread(searchImg);

    if (searchMat.cols < templateMat.cols || searchMat.rows < templateMat.rows) {
        templateMat.delete(); searchMat.delete();
        return 0;
    }

    // Featureless Check
    const grayTemp = new cv.Mat();
    cv.cvtColor(templateMat, grayTemp, cv.COLOR_RGBA2GRAY);
    const mean = new cv.Mat();
    const stdDev = new cv.Mat();
    cv.meanStdDev(grayTemp, mean, stdDev);
    const deviation = stdDev.data64F[0];
    grayTemp.delete(); mean.delete(); stdDev.delete();

    if (deviation < 10) {
        templateMat.delete(); searchMat.delete();
        return 100;
    }

    // --- Optimization: Gaussian Blur ---
    // Blurring removes high-frequency noise/artifacts from perspective warp
    // making the match focus on structural shapes (affine robust).
    const blurredTemplate = new cv.Mat();
    const blurredSearch = new cv.Mat();
    const ksize = new cv.Size(5, 5); // 5x5 kernel size
    cv.GaussianBlur(templateMat, blurredTemplate, ksize, 0, 0, cv.BORDER_DEFAULT);
    cv.GaussianBlur(searchMat, blurredSearch, ksize, 0, 0, cv.BORDER_DEFAULT);

    // Template Matching on BLURRED images
    const result = new cv.Mat();
    const mask = new cv.Mat();
    cv.matchTemplate(blurredSearch, blurredTemplate, result, cv.TM_CCOEFF_NORMED, mask);
    const minMax = cv.minMaxLoc(result);
    const maxLoc = minMax.maxLoc;
    const matchScore = Math.max(0, minMax.maxVal) * 100;

    // AbsDiff Validation (On original images, but aligned)
    const alignedRect = new cv.Rect(maxLoc.x, maxLoc.y, templateMat.cols, templateMat.rows);
    const alignedTestMat = searchMat.roi(alignedRect);
    
    // Also blur before diffing to ignore pixel noise
    const alignedTestBlurred = new cv.Mat();
    cv.GaussianBlur(alignedTestMat, alignedTestBlurred, ksize, 0, 0, cv.BORDER_DEFAULT);

    const diffMat = new cv.Mat();
    cv.absdiff(blurredTemplate, alignedTestBlurred, diffMat); // Diff the blurred versions
    
    const diffGray = new cv.Mat();
    cv.cvtColor(diffMat, diffGray, cv.COLOR_RGBA2GRAY);
    const diffBinary = new cv.Mat();
    // Threshold higher to ignore minor intensity shifts
    cv.threshold(diffGray, diffBinary, 45, 255, cv.THRESH_BINARY);
    
    const nonZero = cv.countNonZero(diffBinary);
    const diffRatio = nonZero / (templateMat.cols * templateMat.rows);

    let penalty = 0;
    if (diffRatio > 0.02) { 
        penalty = (diffRatio * 100) * 2.0; 
    }
    
    // Cleanup
    result.delete(); mask.delete(); alignedTestMat.delete(); 
    diffMat.delete(); diffGray.delete(); diffBinary.delete();
    templateMat.delete(); searchMat.delete();
    blurredTemplate.delete(); blurredSearch.delete(); alignedTestBlurred.delete();

    return Math.round(Math.max(0, Math.min(100, matchScore - penalty)));

  } catch (error) {
    console.error("Comparison Error:", error);
    return 0;
  }
};
