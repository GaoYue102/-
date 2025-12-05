
import React, { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize, Activity, AlertTriangle } from 'lucide-react';
import { GridCell, FinalDefect, TransformState } from '../types';

interface ZoomableImageProps {
  src: string;
  title: string;
  borderColor?: string;
  transform: TransformState;
  onTransformChange: (newTransform: TransformState) => void;
  // Hierarchical Grid Props
  gridCells?: GridCell[];
  finalDefects?: FinalDefect[];
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({ 
  src, 
  title, 
  borderColor = 'border-slate-600',
  transform,
  onTransformChange,
  gridCells = [],
  finalDefects = []
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Auto-fit image
  const handleImageLoad = () => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;

    const contentWidth = img.naturalWidth;
    const contentHeight = img.naturalHeight;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (contentWidth === 0 || contentHeight === 0) return;

    const scaleX = containerWidth / contentWidth;
    const scaleY = containerHeight / contentHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.95;
    const x = (containerWidth - contentWidth * fitScale) / 2;
    const y = (containerHeight - contentHeight * fitScale) / 2;

    onTransformChange({ scale: fitScale, x, y });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ 
      x: e.clientX - transform.x, 
      y: e.clientY - transform.y 
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isDragging) {
      onTransformChange({
        ...transform,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scaleAdjustment = -e.deltaY * 0.001;
    const newScale = Math.min(Math.max(0.05, transform.scale + scaleAdjustment), 20);
    const scaleRatio = newScale / transform.scale;
    onTransformChange({
      scale: newScale,
      x: mouseX - (mouseX - transform.x) * scaleRatio,
      y: mouseY - (mouseY - transform.y) * scaleRatio
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preventDefault = (e: Event) => e.preventDefault();
    container.addEventListener('wheel', preventDefault, { passive: false });
    return () => container.removeEventListener('wheel', preventDefault);
  }, []);

  return (
    <div className={`flex flex-col h-full bg-slate-800/50 rounded-lg overflow-hidden border ${borderColor} relative`}>
      {/* Controls */}
      <div className="absolute top-4 right-4 z-30 flex gap-1 bg-slate-900/90 backdrop-blur rounded-lg border border-slate-700 p-1 shadow-lg">
           <button onClick={() => onTransformChange({...transform, scale: transform.scale * 0.8})} className="p-1.5 hover:bg-slate-700 rounded text-slate-300">
            <ZoomOut size={16} />
          </button>
           <button onClick={handleImageLoad} className="p-1.5 hover:bg-slate-700 rounded text-slate-300" title="Reset View">
            <Maximize size={16} />
          </button>
          <button onClick={() => onTransformChange({...transform, scale: transform.scale * 1.2})} className="p-1.5 hover:bg-slate-700 rounded text-slate-300">
            <ZoomIn size={16} />
          </button>
      </div>

      <div 
        ref={containerRef}
        className="relative flex-1 overflow-hidden grid-pattern cursor-move"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div 
          style={{ 
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: 'fit-content',
            height: 'fit-content',
          }}
          className="relative"
        >
          <img 
            ref={imgRef}
            src={src} 
            alt={title} 
            onLoad={handleImageLoad}
            className="block max-w-none pointer-events-none select-none"
            draggable={false}
          />
          
          {/* Active Grid Cells */}
          {gridCells.map((cell) => {
            // Determine visual style
            let borderColor = 'border-blue-400/30';
            let bgColor = 'bg-transparent';
            let textColor = 'text-blue-300';
            let showScore = false;

            if (cell.status === 'analyzing') {
                borderColor = 'border-cyan-400/50 animate-pulse';
                bgColor = 'bg-cyan-500/10';
            } else if (cell.status === 'ok') {
                borderColor = 'border-green-500/30';
                textColor = 'text-green-500';
                showScore = true;
            } else if (cell.status === 'defect') {
                borderColor = 'border-red-500/60';
                bgColor = 'bg-red-500/10';
                textColor = 'text-red-400';
                showScore = true;
            }

            return (
              <div
                key={cell.id}
                className={`absolute border-dashed border pointer-events-none flex items-center justify-center transition-all duration-300 ${borderColor} ${bgColor}`}
                style={{
                  left: cell.x,
                  top: cell.y,
                  width: cell.width,
                  height: cell.height,
                  borderWidth: '1px'
                }}
              >
                 {showScore && (
                     <div className={`px-1 py-0.5 text-[8px] md:text-[10px] font-mono font-bold rounded backdrop-blur-md shadow-sm ${
                         cell.status === 'defect' ? 'bg-red-600 text-white' : 'bg-green-900/40 text-green-300'
                     }`}>
                        {cell.score}%
                     </div>
                 )}
              </div>
            );
          })}

          {/* Final Fused Defects */}
          {finalDefects.map((d) => (
             <div
               key={d.id}
               className="absolute border-2 border-red-500 bg-red-500/10 z-20 shadow-[0_0_20px_rgba(239,68,68,0.5)] animate-pulse"
               style={{
                  left: d.x,
                  top: d.y,
                  width: d.width,
                  height: d.height,
               }}
             >
                <div className="absolute -top-6 left-0 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded shadow flex items-center gap-1">
                   <AlertTriangle size={12}/> 差异
                </div>
             </div>
          ))}

        </div>
      </div>
    </div>
  );
};
