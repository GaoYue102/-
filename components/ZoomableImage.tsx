
import React, { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize, AlertTriangle } from 'lucide-react';
import { FinalDefect, TransformState } from '../types';

interface ZoomableImageProps {
  src: string;
  title: string;
  borderColor?: string;
  transform: TransformState;
  onTransformChange: (newTransform: TransformState) => void;
  finalDefects?: FinalDefect[];
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({ 
  src, 
  title, 
  borderColor = 'border-slate-600',
  transform,
  onTransformChange,
  finalDefects = []
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const handleImageLoad = () => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const fitScale = Math.min(container.clientWidth / img.naturalWidth, container.clientHeight / img.naturalHeight) * 0.95;
    onTransformChange({ scale: fitScale, x: (container.clientWidth - img.naturalWidth * fitScale) / 2, y: (container.clientHeight - img.naturalHeight * fitScale) / 2 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); setIsDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isDragging) onTransformChange({ ...transform, x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const newScale = Math.min(Math.max(0.05, transform.scale + (-e.deltaY * 0.001)), 20);
    const scaleRatio = newScale / transform.scale;
    onTransformChange({ scale: newScale, x: mouseX - (mouseX - transform.x) * scaleRatio, y: mouseY - (mouseY - transform.y) * scaleRatio });
  };

  useEffect(() => {
    containerRef.current?.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }, []);

  return (
    <div className={`flex flex-col h-full bg-slate-800/50 rounded-lg overflow-hidden border ${borderColor} relative`}>
      <div className="absolute top-4 right-4 z-30 flex gap-1 bg-slate-900/90 backdrop-blur rounded-lg border border-slate-700 p-1 shadow-lg">
           <button onClick={() => onTransformChange({...transform, scale: transform.scale * 0.8})} className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition-colors"><ZoomOut size={16} /></button>
           <button onClick={handleImageLoad} className="p-1.5 hover:bg-slate-700 rounded text-slate-300" title="Reset View"><Maximize size={16} /></button>
          <button onClick={() => onTransformChange({...transform, scale: transform.scale * 1.2})} className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition-colors"><ZoomIn size={16} /></button>
      </div>

      <div 
        ref={containerRef}
        className="relative flex-1 overflow-hidden grid-pattern cursor-move"
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}
      >
        <div style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: '0 0', width: 'fit-content', height: 'fit-content' }} className="relative">
          <img ref={imgRef} src={src} alt={title} onLoad={handleImageLoad} className="block max-w-none pointer-events-none select-none" draggable={false} />
          
          {finalDefects.map((d) => (
             <div key={d.id} className="absolute border-2 border-indigo-500 bg-indigo-500/10 z-20 shadow-[0_0_30px_rgba(99,102,241,0.5)] transition-all duration-500 group/defect" style={{ left: d.x, top: d.y, width: d.width, height: d.height }}>
                <div className="absolute -top-7 left-0 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg flex items-center gap-1 whitespace-nowrap">
                   <AlertTriangle size={12}/> AI 检测点
                </div>
                {d.description && (
                   <div className="absolute top-full mt-1 left-0 bg-black/90 backdrop-blur-md text-slate-200 p-3 rounded border border-indigo-500/30 text-[10px] w-56 leading-relaxed shadow-2xl opacity-0 group-hover/defect:opacity-100 transition-opacity z-50">
                      <span className="text-indigo-400 font-bold block mb-1">审计判定:</span>
                      {d.description}
                   </div>
                )}
             </div>
          ))}
        </div>
      </div>
    </div>
  );
};
