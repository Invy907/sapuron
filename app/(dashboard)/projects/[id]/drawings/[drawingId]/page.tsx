import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type {
  Drawing,
  DrawingCornerBar,
  DrawingSegment,
  Project,
  Unit,
} from '@/lib/types/database'
import { DrawingViewer } from '@/components/drawing-viewer'
import { DrawingHeader } from '@/components/drawing-header'

export default async function DrawingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; drawingId: string }>
  searchParams: Promise<{ segmentId?: string }>
}) {
  const { id: projectId, drawingId } = await params
  const { segmentId } = await searchParams
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single<Project>()

  const { data: drawing } = await supabase
    .from('drawings')
    .select('*')
    .eq('id', drawingId)
    .single<Drawing>()

  if (!drawing) notFound()

  const { data: signedUrlData } = await supabase.storage
    .from('drawings')
    .createSignedUrl(drawing.file_path, 3600)

  const { data: segments } = await supabase
    .from('drawing_segments')
    .select('*')
    .eq('drawing_id', drawingId)
    .order('created_at', { ascending: true })
    .returns<DrawingSegment[]>()

  const { data: cornerBars } = await supabase
    .from('drawing_corner_bars')
    .select('*')
    .eq('drawing_id', drawingId)
    .order('created_at', { ascending: true })
    .returns<DrawingCornerBar[]>()

  const { data: units } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: true })
    .returns<Unit[]>()

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-4rem)]">
      {project && (
        <DrawingHeader
          projectId={project.id}
          projectName={project.name}
          drawingFileName={drawing.file_name}
        />
      )}

      <DrawingViewer
        drawingId={drawingId}
        projectId={projectId}
        imageUrl={signedUrlData?.signedUrl ?? ''}
        fileType={drawing.file_type}
        initialSegments={segments ?? []}
        initialSelectedSegmentId={segmentId}
        initialCornerBars={cornerBars ?? []}
        units={units ?? []}
      />
    </div>
  )
}
