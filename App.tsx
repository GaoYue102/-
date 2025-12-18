
import React, { useState, useRef } from 'react';
import { Upload, Play, RefreshCw, Activity, Layers, GitMerge, AlertTriangle, Cpu, BrainCircuit } from 'lucide-react';
import { alignAndCropImages, detectDefectsFullImage } from './services/geminiService';
import { ZoomableImage } from './components/ZoomableImage';
import { ImageState, FinalDefect, TransformState } from './types';

const App: React.FC = () => {
  const [refImage, setRefImage] = useState<ImageState>({ file: null, previewUrl: null, base64: null, width: 0, height: 0 });
  const [testImage, setTestImage] = useState<ImageState>({ file: null, previewUrl: null, base64: null, width: 0, height: 0 });
  const [viewTransform, setViewTransform] = useState<TransformState>({ scale: 1, x: 0, y: 0 });

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>("");
  const [finalDefects, setFinalDefects] = useState<FinalDefect[]>([]);
  const [progress, setProgress] = useState(0);

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
    setFinalDefects([]);
    setProcessingStep("");
    setProgress(0);
    setViewTransform({ scale: 1, x: 0, y: 0 });
  };

  const runFullAiAnalysis = async () => {
      if (!refImage.base64 || !testImage.base64) return;
      
      abortRef.current = false;
      setIsProcessing(true);
      setFinalDefects([]);
      setProgress(5);

      try {
          setProcessingStep("几何对齐：正在精确定位关键特征...");
          const alignedResult = await alignAndCropImages(refImage.base64, testImage.base64);
          if (abortRef.current) return;

          let currentRef = refImage.base64;
          let currentTest = testImage.base64;
          let currentW = refImage.width;
          let currentH = refImage.height;

          if (alignedResult) {
              currentRef = alignedResult.refCropped;
              currentTest = alignedResult.testCropped;
              currentW = alignedResult.width;
              currentH = alignedResult.height;
              setRefImage(prev => ({ ...prev, base64: alignedResult.refCropped, previewUrl: alignedResult.refCropped, width: alignedResult.width, height: alignedResult.height }));
              setTestImage(prev => ({ ...prev, base64: alignedResult.testCropped, previewUrl: alignedResult.testCropped, width: alignedResult.width, height: alignedResult.height }));
          }
          setProgress(25);

          setProcessingStep("AI 推理：正在执行高维特征对比分析...");
          const results = await detectDefectsFullImage(currentRef, currentTest);
          if (abortRef.current) return;

          const defects: FinalDefect[] = results.map((res, i) => ({
              id: `ai-defect-${i}`,
              x: res.x * currentW,
              y: res.y * currentH,
              width: res.w * currentW,
              height: res.h * currentH,
              description: res.description,
              isAiConfirmed: true
          }));

          setFinalDefects(defects);
          setProcessingStep(defects.length > 0 ? `检测完成：发现 ${defects.length} 处异常` : "检测完成：未发现异常点");
          setProgress(100);

      } catch (e: any) {
          if (!abortRef.current) setProcessingStep("审计中断: " + e.message);
          console.error(e);
      } finally {
          setIsProcessing(false);
      }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 selection:bg-indigo-500/30 font-sans">
      <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-2xl z-20">
          <div className="flex items-center gap-3">
             <div className="bg-indigo-600 p-2 rounded-xl shadow-inner">
                <BrainCircuit className="text-white" size={20} />
             </div>
             <div className="flex flex-col">
                <h1 className="font-black text-white tracking-wider text-sm leading-tight">VISUAL QA EXPERT</h1>
                <span className="text-[10px] text-indigo-400 font-mono uppercase tracking-[0.2em]">Assembly Precision Audit</span>
             </div>
          </div>
          <button onClick={handleReset} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white px-4 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-all hover:border-slate-500">
             <RefreshCw size={14} /> 清除数据
          </button>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {(!refImage.previewUrl || !testImage.previewUrl) ? (
            <div className="flex-1 flex items-center justify-center gap-12 bg-grid-slate-900/[0.04]">
                <div className="text-center group cursor-pointer" onClick={() => document.getElementById('ref-upload')?.click()}>
                    <div className="w-72 h-72 border-2 border-dashed border-slate-700 rounded-3xl flex flex-col items-center justify-center hover:border-indigo-500 hover:bg-indigo-500/5 transition-all duration-300 transform group-hover:scale-105">
                        {refImage.previewUrl ? <img src={refImage.previewUrl} className="w-full h-full object-contain p-4" /> : <><Upload className="mb-4 text-slate-600 group-hover:text-indigo-500" size={48} /><span className="text-slate-500 group-hover:text-slate-300 font-medium">导入参考标准图</span></>}
                    </div>
                    <input id="ref-upload" type="file" hidden accept="image/*" onChange={(e) => handleImageUpload(e, 'ref')} />
                    <p className="mt-4 text-[10px] text-slate-500 font-mono uppercase tracking-widest">Master Reference</p>
                </div>
                <div className="text-center group cursor-pointer" onClick={() => document.getElementById('test-upload')?.click()}>
                    <div className="w-72 h-72 border-2 border-dashed border-slate-700 rounded-3xl flex flex-col items-center justify-center hover:border-pink-500 hover:bg-pink-500/5 transition-all duration-300 transform group-hover:scale-105">
                        {testImage.previewUrl ? <img src={testImage.previewUrl} className="w-full h-full object-contain p-4" /> : <><Upload className="mb-4 text-slate-600 group-hover:text-pink-500" size={48} /><span className="text-slate-500 group-hover:text-slate-300 font-medium">导入待测产品图</span></>}
                    </div>
                    <input id="test-upload" type="file" hidden accept="image/*" onChange={(e) => handleImageUpload(e, 'test')} />
                     <p className="mt-4 text-[10px] text-slate-500 font-mono uppercase tracking-widest">Inspection Target</p>
                </div>
            </div>
        ) : (
            <>
                <div className="flex-1 flex flex-col p-6 gap-6">
                     <div className="flex justify-center gap-4 bg-slate-900/50 backdrop-blur-md p-4 rounded-2xl border border-slate-800 shrink-0 shadow-xl">
                        {isProcessing ? (
                            <div className="flex items-center gap-6 w-full max-w-3xl">
                                <div className="flex items-center gap-3 px-4 py-2 text-indigo-400 font-bold text-xs border border-indigo-500/30 rounded-xl bg-indigo-900/20">
                                    <Activity size={16} className="animate-spin" /> {processingStep}
                                </div>
                                <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700 p-0.5">
                                    <div className="h-full bg-gradient-to-r from-indigo-600 via-purple-500 to-pink-500 transition-all duration-700 ease-out rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)]" style={{width: `${progress}%`}}></div>
                                </div>
                                <span className="text-xs font-mono text-indigo-300 w-10 text-right">{progress}%</span>
                            </div>
                        ) : (
                            <button onClick={runFullAiAnalysis} className="group relative flex items-center gap-3 px-16 py-4 rounded-2xl font-black text-sm bg-indigo-600 text-white shadow-2xl shadow-indigo-500/30 hover:bg-indigo-500 transition-all active:scale-95 overflow-hidden">
                               <Play size={18} fill="currentColor" /> 启动深度审计引擎
                               <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 skew-x-12"></div>
                            </button>
                        )}
                     </div>

                     <div className="flex-1 grid grid-cols-2 gap-6 min-h-0">
                         <div className="relative border border-slate-800 rounded-2xl overflow-hidden shadow-inner bg-slate-900/40">
                             <div className="absolute top-4 left-4 z-20 bg-slate-900/80 backdrop-blur-md text-indigo-300 text-[10px] px-3 py-1.5 rounded-lg border border-indigo-500/20 font-bold uppercase tracking-widest">Ref-Standard</div>
                             <ZoomableImage src={refImage.previewUrl} title="Reference" transform={viewTransform} onTransformChange={setViewTransform} />
                         </div>
                         <div className="relative border border-slate-800 rounded-2xl overflow-hidden shadow-inner bg-slate-900/40">
                             <div className="absolute top-4 left-4 z-20 bg-slate-900/80 backdrop-blur-md text-pink-300 text-[10px] px-3 py-1.5 rounded-lg border border-pink-500/20 font-bold uppercase tracking-widest">Test-Result</div>
                             <ZoomableImage src={testImage.previewUrl} title="Test" transform={viewTransform} onTransformChange={setViewTransform} finalDefects={finalDefects} />
                         </div>
                     </div>
                </div>

                <div className="w-96 bg-slate-900/80 backdrop-blur-xl border-l border-slate-800 p-8 flex flex-col gap-8 overflow-y-auto z-30 shadow-2xl">
                    <div className="border-b border-slate-800 pb-6">
                        <h2 className="text-white font-bold text-xl mb-1 flex items-center gap-3">
                          <Layers className="text-indigo-500" size={24}/> 分析报告
                        </h2>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-mono tracking-widest">
                          <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-indigo-500'}`}></div>
                          AI-Powered Inspection Engine
                        </div>
                    </div>

                    <div className="space-y-5">
                        {finalDefects.length > 0 ? (
                            finalDefects.map((defect, i) => (
                                <div key={defect.id} className="group p-5 bg-indigo-900/5 border border-indigo-500/20 rounded-2xl animate-in fade-in slide-in-from-right duration-500 hover:bg-indigo-900/10 hover:border-indigo-500/40 transition-all cursor-default">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2 text-indigo-400 text-sm font-black">
                                            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px]">
                                              {i+1}
                                            </div>
                                            装配异常
                                        </div>
                                        <div className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-md text-[9px] font-bold border border-indigo-500/20">
                                            FLASH-AI
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-400 leading-relaxed italic group-hover:text-slate-200 transition-colors">
                                        "{defect.description}"
                                    </p>
                                </div>
                            ))
                        ) : !isProcessing && progress === 100 ? (
                            <div className="p-8 bg-emerald-950/10 border border-emerald-500/20 rounded-2xl text-center shadow-lg">
                                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <GitMerge className="text-emerald-500" size={32} />
                                </div>
                                <h3 className="text-emerald-400 font-bold mb-2">全系统合格</h3>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    未在产品中发现任何关键缺失、偏移或显著的几何差异。
                                </p>
                            </div>
                        ) : isProcessing ? (
                             <div className="text-center py-16 flex flex-col items-center">
                                <div className="relative mb-6">
                                  <BrainCircuit className="text-indigo-500 animate-pulse" size={48} />
                                  <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full"></div>
                                </div>
                                <h4 className="text-indigo-300 font-bold text-sm mb-1">正在进行深度审计</h4>
                                <p className="text-[10px] text-slate-500 font-mono italic max-w-[200px]">
                                  Comparing pixel variance and geometric alignment patterns...
                                </p>
                            </div>
                        ) : (
                            <div className="text-center py-20">
                                <Activity className="mx-auto text-slate-800 mb-4 opacity-30" size={48} />
                                <p className="text-xs text-slate-600 font-medium italic">请先导入并分析图像</p>
                            </div>
                        )}
                    </div>
                </div>
            </>
        )}
      </main>
    </div>
  );
};

export default App;
