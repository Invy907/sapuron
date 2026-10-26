import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type {
  Project,
  DrawingCornerBar,
  DrawingSegment,
  Drawing,
  Unit,
} from '@/lib/types/database'
import { OptimizeClient } from '@/components/optimize-client'
import { parsePieceLengthAdjustment } from '@/lib/optimize-settings'

export default async function OptimizePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ segmentId?: string; run?: string; adjustment?: string }>
}) {
  const { id: projectId } = await params
  const { segmentId, run, adjustment } = await searchParams
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single<Project>()

  if (!project) notFound()

  const { data: latestDrawing } = await supabase
    .from('drawings')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single<Pick<Drawing, 'id'> | null>()

  const { data: projectDrawings } = await supabase
    .from('drawings')
    .select('id')
    .eq('project_id', projectId)
    .returns<Pick<Drawing, 'id'>[]>()

  const drawingIds = projectDrawings?.map((d) => d.id) ?? []

  const { data: segments } = await supabase
    .from('drawing_segments')
    .select('*')
    .in('drawing_id', drawingIds)
    .returns<DrawingSegment[]>()

  const { data: cornerBars } = await supabase
    .from('drawing_corner_bars')
    .select('*')
    .in('drawing_id', drawingIds)
    .order('created_at', { ascending: true })
    .returns<DrawingCornerBar[]>()

  const { data: units } = await supabase
    .from('units')
    .select('*')
    .returns<Unit[]>()

  return (
    <div>
      <div className="mb-6 print:hidden">
        <Link
          href={
            latestDrawing?.id
              ? `/projects/${projectId}/drawings/${latestDrawing.id}`
              : `/projects/${projectId}`
          }
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; 図面に戻る
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-bold print:hidden">{project.name}</h1>
      <p className="mb-6 text-sm text-muted print:hidden">切断最適化の計算</p>

      <OptimizeClient
        projectId={projectId}
        segments={segments ?? []}
        initialFocusSegmentId={segmentId}
        initialPieceLengthAdjustmentMm={parsePieceLengthAdjustment(adjustment)}
        autoRun={run === '1'}
        units={units ?? []}
        cornerBars={cornerBars ?? []}
      />
    </div>
  )
}
