'use client'

export function SunraysLayer() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div
        style={{
          position: 'absolute',
          top: '-40%',
          right: '-30%',
          width: '130%',
          height: '180%',
          background: [
            'conic-gradient(',
            'from 0deg,',
            'transparent 0deg, rgba(255,184,0,0.045) 9deg,',
            'transparent 18deg, rgba(255,160,0,0.055) 28deg,',
            'transparent 38deg, rgba(255,200,0,0.04) 47deg,',
            'transparent 57deg, rgba(255,130,0,0.05) 67deg,',
            'transparent 77deg, rgba(255,184,0,0.06) 86deg,',
            'transparent 96deg, rgba(255,220,0,0.045) 106deg,',
            'transparent 116deg, rgba(255,100,0,0.04) 126deg,',
            'transparent 136deg, rgba(255,184,0,0.055) 146deg,',
            'transparent 156deg, rgba(255,160,0,0.048) 166deg,',
            'transparent 176deg, rgba(255,220,0,0.06) 186deg,',
            'transparent 196deg, rgba(255,184,0,0.04) 206deg,',
            'transparent 216deg, rgba(255,130,0,0.055) 226deg,',
            'transparent 236deg, rgba(255,200,0,0.05) 246deg,',
            'transparent 256deg, rgba(255,184,0,0.045) 266deg,',
            'transparent 276deg, rgba(255,220,0,0.06) 286deg,',
            'transparent 296deg, rgba(255,160,0,0.05) 306deg,',
            'transparent 316deg, rgba(255,184,0,0.04) 326deg,',
            'transparent 336deg, rgba(255,100,0,0.055) 346deg,',
            'transparent 356deg, rgba(255,184,0,0.045) 360deg',
            ')',
          ].join(' '),
          animationName: 'sunray-rotate',
          animationDuration: '120s',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          transformOrigin: 'center center',
        }}
      />
    </div>
  )
}
