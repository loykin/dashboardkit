import React, { useCallback, useEffect, useRef } from 'react'
import GridLayout, { type LayoutItem } from 'react-grid-layout'
import type { CoreEngineAPI } from '../schema'
import type { DashboardInput, FieldConfig, PanelConfig, PanelRuntimeInstance, QueryResult } from '../schema'
import { useDashboard, usePanel } from '../hooks'
// CSS must be imported by the consumer (e.g. playground):
// import 'react-grid-layout/css/styles.css'

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PanelRenderProps {
  panelId: string
  panelType: string
  instance: PanelRuntimeInstance
  config: PanelConfig
  options: Record<string, unknown>
  fieldConfig?: FieldConfig
  data: unknown
  rawData: QueryResult[] | null
  loading: boolean
  error: string | null
  /** Ref to attach to the panel root element (enables viewport virtualization) */
  ref: React.RefCallback<HTMLElement>
  /** Alias for ref with a clearer runtime meaning. */
  viewportRef: React.RefCallback<HTMLElement>
  /** Alias for ref with a clearer measurement meaning. */
  measureRef: React.RefCallback<HTMLElement>
}

export interface DashboardGridProps {
  engine: CoreEngineAPI
  config: DashboardInput
  /** Grid container width in px. Auto-measured from parent if omitted. */
  width?: number
  /** Grid edit mode (enables drag and resize) */
  editable?: boolean
  /** Layout change callback (used in editable mode) */
  onLayoutChange?: (layout: readonly LayoutItem[]) => void
  /** Panel render function */
  children: (props: PanelRenderProps) => React.ReactNode
  className?: string
  style?: React.CSSProperties
}

// ─── DashboardGrid ───────────────────────────────────────────────────────────────

export function DashboardGrid({
  engine,
  config,
  width,
  editable = false,
  onLayoutChange,
  children,
  className,
  style,
}: DashboardGridProps) {
  // useDashboard — load config + subscribe to state
  useDashboard(engine, config)
  const panelInstances = engine.getPanelInstances()

  // Auto-measure container width
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(width ?? 1200)

  useEffect(() => {
    if (width !== undefined) return
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setContainerWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [width])

  // Convert runtime panel instances → react-grid-layout Layout.
  const layout: LayoutItem[] = panelInstances.map((p) => ({
    i: p.id,
    x: p.gridPos.x,
    y: p.gridPos.y,
    w: p.gridPos.w,
    h: p.gridPos.h,
    static: !editable,
  }))

  const handleLayoutChange = useCallback(
    (newLayout: readonly LayoutItem[]) => {
      onLayoutChange?.(newLayout)
    },
    [onLayoutChange],
  )

  return (
    <div ref={containerRef} className={className} style={style}>
      <GridLayout
        layout={layout}
        gridConfig={{ cols: config.layout?.cols ?? 24, rowHeight: config.layout?.rowHeight ?? 30, margin: [8, 8] as const }}
        width={containerWidth}
        dragConfig={{ enabled: editable }}
        resizeConfig={{ enabled: editable }}
        onLayoutChange={handleLayoutChange}
      >
        {panelInstances.map((p) => (
          <div key={p.id} style={{ height: '100%' }}>
            <PanelWrapper engine={engine} instance={p}>
              {children}
            </PanelWrapper>
          </div>
        ))}
      </GridLayout>
    </div>
  )
}

// ─── PanelWrapper ────────────────────────────────────────────────────────────────

interface PanelWrapperProps {
  engine: CoreEngineAPI
  instance: PanelRuntimeInstance
  children: (props: PanelRenderProps) => React.ReactNode
}

function PanelWrapper({ engine, instance, children }: PanelWrapperProps) {
  const panelId = instance.id
  const { data, rawData, loading, error, ref } = usePanel(engine, panelId)
  return (
    <>
      {children({
        panelId,
        panelType: instance.type,
        instance,
        config: instance.config,
        options: instance.config.options,
        ...(instance.config.fieldConfig !== undefined ? { fieldConfig: instance.config.fieldConfig } : {}),
        data,
        rawData,
        loading,
        error,
        ref,
        viewportRef: ref,
        measureRef: ref,
      })}
    </>
  )
}
