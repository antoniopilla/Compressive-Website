import { FileImage, FileQuestion, FileText, Layers, PenTool } from 'lucide-react';

const ICONS = { vector: PenTool, raster: FileImage, pdf: FileText, psd: Layers };

/**
 * Category icon. SVG artwork is never rendered inline as a preview — an icon,
 * the filename and its status describe it instead.
 *
 * @param {{ category: string | null, size?: number, className?: string }} props
 */
export default function FileIcon({ category, size = 20, className }) {
  const Icon = ICONS[category] ?? FileQuestion;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
