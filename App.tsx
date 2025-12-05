
import React, { useState, useRef } from 'react';
import { Upload, Scan, RefreshCw, LayoutGrid, Activity, Layers, Play, GitMerge } from 'lucide-react';
import { compareRegionPair, alignAndCropImages } from './services/geminiService';
import { ZoomableImage } from './components/ZoomableImage';
import { ImageState, GridCell, FinalDefect, TransformState } from './types';

const App: React.FC = () => {
  const [refImage, setRefImage] = useState<ImageState>({ file: null, previewUrl: null, base64: null, width: 0, height: 0 });
  const [testImage, setTestImage] = useState<ImageState>({ file: null, previewUrl: null, base64: null, width: 0, height: 0 });
  const [viewTransform, setViewTransform] = useState<TransformState>({ scale: 1, x: 0, y: 0 });

  // Analysis State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>("");
  const [gridCells, setGridCells] = useState<GridCell[]>([]);
  const [finalDefects, setFinalDefects] = useState<FinalDefect[]>([]);
  const [progress, setProgress] = useState(0);

  // Abort Control
  const abortRef = useRef(false);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>, type: 'ref' | 'test') => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
             const state: ImageState = {
                file,
                previewUrl: img.src,
                base64: reader.result as string,
                width: img.width,
                height: img.height
              };
              if (type === 'ref') setRefImage(state);
              else setTestImage(state);
              
              setGridCells([]);
              setFinalDefects([]);
              setProcessingStep("");
              setProgress(0);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReset = () => {
    abortRef.current = true;
    setIsProcessing(false);
    setRefImage({ file: null, previewUrl: null, base64: null, width: 0, height: 0 });
    setTestImage({ file: null, previewUrl: null, base64: null, width: 0, height: 0 });
    setGridCells([]);
    setFinalDefects([]);
    setProcessingStep("");
    setProgress(0);
    setViewTransform({ scale: 1, x: 0, y: 0 });
  };

  const cropImageRegion = async (imgBase64: string, x: number, y: number, w: number, h: number): Promise<string> => {
      return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
              const canvas = document.createElement('canvas');
              const safeW = Math.max(1, w);
              const safeH = Math.max(1, h);
              canvas.width = safeW;
              canvas.height = safeH;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                  ctx.drawImage(img, x, y, safeW, safeH, 0, 0, safeW, safeH);
                  resolve(canvas.toDataURL('image/jpeg', 0.9));
              }
          };
          img.src = imgBase64;
      });
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const runAnalysisWithFusion = async () => {
      if (!refImage.base64 || !testImage.base64) return;
      
      abortRef.current = false;
      setIsProcessing(true);
      setGridCells([]);
      setFinalDefects([]);
      setProgress(0);

      try {
          // --- STEP 1: Alignment & Synchronized Crop ---
          if (abortRef.current) return;
          setProcessingStep("STEP 1: 图像配准与同步裁剪 (Alignment & Crop)...");
          
          let currentRefBase64 = refImage.base64;
          let currentTestBase64 = testImage.base64;
          let scanWidth = refImage.width;
          let scanHeight = refImage.height;

          try {
              const alignedResult = await alignAndCropImages(refImage.base64, testImage.base64);
              
              if (abortRef.current) return;

              if (alignedResult) {
                  currentRefBase64 = alignedResult.refCropped;
                  currentTestBase64 = alignedResult.testCropped;
                  scanWidth = alignedResult.width;
                  scanHeight = alignedResult.height;

                  // Update visible images to cropped versions
                  setRefImage(prev => ({
                      ...prev,
                      base64: alignedResult.refCropped,
                      previewUrl: alignedResult.refCropped,
                      width: alignedResult.width,
                      height: alignedResult.height
                  }));
                  setTestImage(prev => ({
                      ...prev,
                      base64: alignedResult.testCropped,
                      previewUrl: alignedResult.testCropped,
                      width: alignedResult.width,
                      height: alignedResult.height
                  }));
                  
                  setProcessingStep("配准裁剪成功！准备扫描...");
              } else {
                  setProcessingStep("配准异常，尝试使用原图扫描...");
              }
          } catch (e) {
              console.warn("Alignment skipped due to error", e);
          }
          await wait(500);

          // --- STEP 2: 10x10 Grid Init ---
          if (abortRef.current) return;
          setProcessingStep("STEP 2: 10x10 网格初始化...");
          
          const rows = 10;
          const cols = 10;
          const cellW = scanWidth / cols;
          const cellH = scanHeight / rows;

          let localCells: GridCell[] = [];
          for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                  localCells.push({
                      id: `cell-${r}-${c}`,
                      level: 1,
                      x: c * cellW,
                      y: r * cellH,
                      width: cellW,
                      height: cellH,
                      score: 0,
                      status: 'pending'
                  });
              }
          }
          setGridCells([...localCells]);
          
          // --- STEP 3: Sequential Scan ---
          for (let i = 0; i < localCells.length; i++) {
              if (abortRef.current) {
                  console.log("Analysis aborted by user.");
                  return;
              }

              const cell = localCells[i];
              
              setGridCells(prev => {
                  const next = [...prev];
                  next[i] = { ...next[i], status: 'analyzing' };
                  return next;
              });
              setProcessingStep(`扫描中 [${i+1}/100]...`);
              setProgress(Math.round(((i + 1) / 100) * 100));

              // Use current (cropped) images for scanning
              const template = await cropImageRegion(currentRefBase64!, cell.x, cell.y, cell.width, cell.height);
              
              // Add padding for local search tolerance (30%)
              const padX = cell.width * 0.30;
              const padY = cell.height * 0.30;
              const searchX = Math.max(0, cell.x - padX);
              const searchY = Math.max(0, cell.y - padY);
              const searchW = cell.width + padX * 2;
              const searchH = cell.height + padY * 2;
              const search = await cropImageRegion(currentTestBase64!, searchX, searchY, searchW, searchH);

              const score = await compareRegionPair(template, search);
              
              const status = score < 85 ? 'defect' : 'ok';

              localCells[i] = { ...cell, score, status };
              setGridCells([...localCells]);

              await wait(0); // Zero delay for max speed, but keeping yield
          }

          // --- STEP 4: Fusion ---
          if (abortRef.current) return;
          setProcessingStep("STEP 3: 正在合并临近差异区域...");
          const defects = localCells.filter(c => c.status === 'defect');
          let rects = defects.map(d => ({ x: d.x, y: d.y, w: d.width, h: d.height }));
          
          let merged = true;
          while (merged) {
              merged = false;
              for (let i = 0; i < rects.length; i++) {
                  for (let j = i + 1; j < rects.length; j++) {
                      if (doRectsIntersect(rects[i], rects[j])) {
                          rects[i] = mergeRects(rects[i], rects[j]);
                          rects.splice(j, 1);
                          merged = true;
                          j--;
                      }
                  }
              }
          }

          setFinalDefects(rects.map((r, i) => ({
              id: `final-${i}`,
              x: r.x,
              y: r.y,
              width: r.w,
              height: r.h
          })));
          setProcessingStep("检测完成");

      } catch (e) {
          if (!abortRef.current) {
             console.error(e);
             setProcessingStep("Error: " + (e as any).message);
          }
      } finally {
          if (!abortRef.current) {
              setIsProcessing(false);
          }
      }
  };

  const doRectsIntersect = (a: any, b: any) => {
      const tolerance = 5; 
      return !(
          a.x > b.x + b.w + tolerance || 
          a.x + a.w + tolerance < b.x || 
          a.y > b.y + b.h + tolerance || 
          a.y + a.h + tolerance < b.y
      );
  };

  const mergeRects = (a: any, b: any) => {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.max(a.x + a.w, b.x + b.w) - x;
      const h = Math.max(a.y + a.h, b.y + b.h) - y;
      return { x, y, w, h };
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 selection:bg-cyan-500/30">
      <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-lg z-20">
          <div className="flex items-center gap-3">
             <div className="bg-cyan-600 p-1.5 rounded">
                <LayoutGrid className="text-white" size={20} />
             </div>
             <h1 className="font-bold text-white tracking-wide">10x10 Grid Scanner 全图精细扫描系统 (Auto-Crop)</h1>
          </div>
          <button 
             onClick={handleReset}
             className="flex items-center gap-2 text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-800 transition-colors"
          >
             <RefreshCw size={14} /> 重置
          </button>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {(!refImage.previewUrl || !testImage.previewUrl) ? (
            <div className="flex-1 flex items-center justify-center gap-10 bg-grid-pattern">
                <div className="text-center group cursor-pointer" onClick={() => document.getElementById('ref-upload')?.click()}>
                    <div className="w-64 h-64 border-2 border-dashed border-slate-700 rounded-2xl flex flex-col items-center justify-center hover:border-cyan-500 hover:bg-slate-900 transition-all">
                        {refImage.previewUrl ? <img src={refImage.previewUrl} className="w-full h-full object-contain p-2" /> : <><Upload className="mb-4 text-slate-600" size={40} /><span>上传参考模板图</span></>}
                    </div>
                    <input id="ref-upload" type="file" hidden accept="image/*" onChange={(e) => handleImageUpload(e, 'ref')} />
                </div>
                <div className="text-center group cursor-pointer" onClick={() => document.getElementById('test-upload')?.click()}>
                    <div className="w-64 h-64 border-2 border-dashed border-slate-700 rounded-2xl flex flex-col items-center justify-center hover:border-pink-500 hover:bg-slate-900 transition-all">
                        {testImage.previewUrl ? <img src={testImage.previewUrl} className="w-full h-full object-contain p-2" /> : <><Upload className="mb-4 text-slate-600" size={40} /><span>上传测试图像</span></>}
                    </div>
                    <input id="test-upload" type="file" hidden accept="image/*" onChange={(e) => handleImageUpload(e, 'test')} />
                </div>
            </div>
        ) : (
            <>
                <div className="flex-1 flex flex-col p-4 gap-4">
                     <div className="flex justify-center gap-4 bg-slate-900 p-2 rounded-lg border border-slate-800 shrink-0">
                        {isProcessing ? (
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-3 px-6 py-2 text-cyan-400 font-mono text-sm animate-pulse border border-cyan-500/30 rounded-full bg-cyan-900/10">
                                    <Activity size={16} /> {processingStep}
                                </div>
                                <div className="w-32 h-2 bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-cyan-500 transition-all duration-300" style={{width: `${progress}%`}}></div>
                                </div>
                                <span className="text-xs font-mono text-slate-400">{progress}%</span>
                            </div>
                        ) : (
                            <button
                               onClick={runAnalysisWithFusion}
                               className="flex items-center gap-2 px-8 py-2 rounded-full font-bold text-sm bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg hover:scale-105 transition-all"
                            >
                               <Play size={16} /> 开始 10x10 全图扫描
                            </button>
                        )}
                     </div>

                     <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
                         <div className="relative border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
                             <div className="absolute top-2 left-2 z-20 bg-black/60 backdrop-blur text-cyan-200 text-xs px-2 py-1 rounded border border-cyan-500/30">
                                参考模板 (Reference)
                             </div>
                             <ZoomableImage
                                src={refImage.previewUrl}
                                title="Reference"
                                borderColor="border-transparent"
                                transform={viewTransform}
                                onTransformChange={setViewTransform}
                                gridCells={gridCells} 
                             />
                         </div>

                         <div className="relative border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
                             <div className="absolute top-2 left-2 z-20 bg-black/60 backdrop-blur text-pink-200 text-xs px-2 py-1 rounded border border-pink-500/30">
                                测试结果 (Aligned & Cropped)
                             </div>
                             <ZoomableImage
                                src={testImage.previewUrl}
                                title="Test"
                                borderColor="border-transparent"
                                transform={viewTransform}
                                onTransformChange={setViewTransform}
                                gridCells={gridCells}
                                finalDefects={finalDefects}
                             />
                         </div>
                     </div>
                </div>

                {/* Status Sidebar */}
                <div className="w-72 bg-slate-900 border-l border-slate-800 p-6 flex flex-col gap-6 overflow-y-auto z-30 shadow-xl">
                    <div>
                        <h2 className="text-white font-bold mb-4 flex items-center gap-2"><Layers size={18}/> 扫描状态</h2>
                        <div className="grid grid-cols-10 gap-1 mb-4">
                            {/* Mini Map Visualization */}
                            {Array.from({length: 100}).map((_, i) => {
                                const cell = gridCells[i];
                                let color = 'bg-slate-800';
                                if (cell) {
                                    if (cell.status === 'defect') color = 'bg-red-500';
                                    else if (cell.status === 'ok') color = 'bg-green-500';
                                    else if (cell.status === 'analyzing') color = 'bg-cyan-400 animate-pulse';
                                }
                                return (
                                    <div key={i} className={`w-full pt-[100%] relative rounded-[1px] ${color}`}></div>
                                )
                            })}
                        </div>
                        
                        <div className="space-y-2">
                             <div className="text-xs text-slate-400 font-mono">
                                已扫描: {gridCells.filter(c => c.status === 'ok' || c.status === 'defect').length} / 100
                             </div>
                             <div className="text-xs text-red-400 font-mono">
                                发现差异: {gridCells.filter(c => c.status === 'defect').length}
                             </div>
                        </div>
                    </div>
                    
                    {finalDefects.length > 0 && (
                        <div className="mt-auto animate-in slide-in-from-bottom">
                            <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl">
                                <div className="flex items-center gap-2 text-red-400 font-bold mb-2">
                                    <Activity size={16} /> 扫描完成
                                </div>
                                <p className="text-sm text-red-200 leading-relaxed">
                                    经融合算法处理，最终判定 <span className="font-bold text-white text-lg mx-1">{finalDefects.length}</span> 处差异区域。
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </>
        )}
      </main>
    </div>
  );
};

export default App;
