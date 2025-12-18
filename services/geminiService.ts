
import { GoogleGenAI, Type } from "@google/genai";

declare global {
  interface Window {
    cv: any;
  }
}

/**
 * 辅助函数：将 Base64 图像缩放并压缩，以平衡速度与精度
 */
const prepareImageForAi = async (base64: string, maxDim: number = 1600): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // 计算缩放比例，保留足够细节但限制总量
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      // 使用 0.85 的质量，在体积和 AI 识别精度间达到最优平衡
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.src = base64;
  });
};

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
  while (tries < 50) {
    if (typeof window.cv !== 'undefined' && window.cv.Mat) return true;
    await new Promise(r => setTimeout(r, 100));
    tries++;
  }
  return false;
};

/**
 * 优化后的缺陷检测：平衡速度与缺失物体的检出率
 */
export const detectDefectsFullImage = async (
  refBase64: string,
  testBase64: string
): Promise<{ x: number, y: number, w: number, h: number, description: string }[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // 在传输给 AI 之前进行预处理（缩放至 1600px，压缩质量 0.85）
  const [refData, testData] = await Promise.all([
    prepareImageForAi(refBase64),
    prepareImageForAi(testBase64)
  ]);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            { text: "## 工业视觉审计专家 (快速高精模式)\n" +
                    "请执行装配审计。重点：识别【缺失部件】。\n\n" +
                    "### 审计逻辑：\n" +
                    "1. **清单比对**：从参考图识别所有组件（螺钉、连接器、零件）。\n" +
                    "2. **缺失判定**：若待测图对应位置看到底材、空孔或背景，判定为 MISSING。\n" +
                    "3. **多余判定**：识别待测图中新增的异物，判定为 EXTRA。\n\n" +
                    "### 坐标：[0, 1000]。" },
            { inlineData: { mimeType: 'image/jpeg', data: refData } },
            { inlineData: { mimeType: 'image/jpeg', data: testData } }
          ]
        }
      ],
      config: {
        // 降低思考预算至 8k 以缩短响应时间，同时保证足够的核对逻辑
        thinkingConfig: { thinkingBudget: 8192 }, 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            defects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  box_2d: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                    description: "[ymin, xmin, ymax, xmax]"
                  },
                  type: { type: Type.STRING, enum: ["MISSING", "EXTRA", "MISALIGNED"] },
                  description: { type: Type.STRING }
                },
                required: ["box_2d", "type", "description"]
              }
            }
          },
          required: ["defects"]
        }
      }
    });

    const result = JSON.parse(response.text || "{\"defects\": []}");
    return result.defects.map((d: any) => {
      const [ymin, xmin, ymax, xmax] = d.box_2d;
      return {
        x: xmin / 1000,
        y: ymin / 1000,
        w: (xmax - xmin) / 1000,
        h: (ymax - ymin) / 1000,
        description: `[${d.type}] ${d.description}`
      };
    });
  } catch (error: any) {
    console.error("Gemini Detection Error:", error);
    throw error;
  }
};

/**
 * 优化后的几何对齐：提升特征匹配效率
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
    
    // 如果原图极大，先在 OpenCV 内部进行初步缩放处理可以大幅加快计算速度
    const MAX_ALIGN_DIM = 2000;
    let scale = 1.0;
    if (refImg.width > MAX_ALIGN_DIM) scale = MAX_ALIGN_DIM / refImg.width;

    const refMat = cv.imread(refImg);
    const testMat = cv.imread(testImg);
    
    const refGray = new cv.Mat();
    const testGray = new cv.Mat();
    cv.cvtColor(refMat, refGray, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(testMat, testGray, cv.COLOR_RGBA2GRAY);

    // 调整特征点数量，维持对齐精度的同时减少计算耗时
    const orb = new cv.ORB(5000); 
    const keypointsRef = new cv.KeyPointVector();
    const keypointsTest = new cv.KeyPointVector();
    const descriptorsRef = new cv.Mat();
    const descriptorsTest = new cv.Mat();

    orb.detectAndCompute(refGray, new cv.Mat(), keypointsRef, descriptorsRef);
    orb.detectAndCompute(testGray, new cv.Mat(), keypointsTest, descriptorsTest);

    if (descriptorsRef.empty() || descriptorsTest.empty()) {
       throw new Error("Alignment features missing");
    }

    const bf = new cv.BFMatcher(cv.NORM_HAMMING, true);
    const matches = new cv.DMatchVector();
    bf.match(descriptorsRef, descriptorsTest, matches);

    const matchArray = [];
    for (let i = 0; i < matches.size(); i++) matchArray.push(matches.get(i));
    matchArray.sort((a, b) => a.distance - b.distance);
    
    // 精简匹配点，选取前 15% 的高质量匹配即可
    const goodMatches = matchArray.slice(0, Math.min(300, Math.max(50, Math.floor(matchArray.length * 0.15))));
    
    let warpedMat = new cv.Mat();
    let finalCropRect: any = null;

    if (goodMatches.length >= 4) {
      const srcPoints = new cv.Mat(goodMatches.length, 1, cv.CV_32FC2);
      const dstPoints = new cv.Mat(goodMatches.length, 1, cv.CV_32FC2);
      for (let i = 0; i < goodMatches.length; i++) {
        const matIdx = goodMatches[i]; 
        const kpTest = keypointsTest.get(matIdx.trainIdx); 
        const kpRef = keypointsRef.get(matIdx.queryIdx);
        srcPoints.data32F[i * 2] = kpTest.pt.x;
        srcPoints.data32F[i * 2 + 1] = kpTest.pt.y;
        dstPoints.data32F[i * 2] = kpRef.pt.x;
        dstPoints.data32F[i * 2 + 1] = kpRef.pt.y;
      }
      
      const mask = new cv.Mat();
      const H = cv.findHomography(srcPoints, dstPoints, cv.RANSAC, 4.0, mask); 
      
      if (!H.empty()) {
        const dsize = new cv.Size(refMat.cols, refMat.rows);
        cv.warpPerspective(testMat, warpedMat, H, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0,0,0,0));
        
        const margin = 0.04; 
        const x1 = Math.ceil(refMat.cols * margin);
        const y1 = Math.ceil(refMat.rows * margin);
        const w = Math.floor(refMat.cols * (1 - 2 * margin));
        const h = Math.floor(refMat.rows * (1 - 2 * margin));
        finalCropRect = new cv.Rect(x1, y1, w, h);
        
        H.delete();
      }
      srcPoints.delete(); dstPoints.delete(); mask.delete();
    }

    if (warpedMat.empty()) {
       testMat.copyTo(warpedMat);
       finalCropRect = new cv.Rect(0, 0, refMat.cols, refMat.rows);
    }

    const finalRef = refMat.roi(finalCropRect);
    const finalTest = warpedMat.roi(finalCropRect);
    
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, finalRef);
    const refOut = canvas.toDataURL('image/jpeg', 0.9); // 对齐结果也稍微压缩以提升内存效率
    cv.imshow(canvas, finalTest);
    const testOut = canvas.toDataURL('image/jpeg', 0.9);

    [refMat, testMat, refGray, testGray, descriptorsRef, descriptorsTest, warpedMat, finalRef, finalTest].forEach(m => m.delete());
    [keypointsRef, keypointsTest, matches, bf, orb].forEach(o => { if(o.delete) o.delete(); });

    return { refCropped: refOut, testCropped: testOut, width: finalCropRect.width, height: finalCropRect.height };
  } catch (e) {
    console.error("Alignment Error:", e);
    return null;
  }
};
