import type { CSSProperties } from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const violet = '#8d79ff'
const cyan = '#58d8ff'

function Hand({ side, frame }: { side: 'left' | 'right'; frame: number }) {
  const cut = frame < 10 ? 0 : frame < 20 ? 1 : frame < 31 ? 2 : 3
  const snap = cut === 0 ? -22 : cut === 1 ? 26 : cut === 2 ? -8 : 0
  const approach = interpolate(frame, [31, 57], [0, 1], { ...clamp, easing: Easing.bezier(.16, .9, .24, 1) })
  const recoil = interpolate(frame, [57, 67, 76], [0, side === 'left' ? -12 : 12, 0], clamp)
  const sign = side === 'left' ? -1 : 1
  const x = sign * interpolate(approach, [0, 1], [225, 94], clamp) + recoil
  const y = side === 'left' ? interpolate(approach, [0, 1], [42, 3], clamp) : interpolate(approach, [0, 1], [-42, -3], clamp)
  const rotate = sign * interpolate(approach, [0, 1], [snap, 7], clamp)
  const poseAngles = cut === 0 ? [-43, -13, 0, 17, 43] : cut === 1 ? [-18, 8, 28, 49, 66] : cut === 2 ? [-60, -28, 4, 28, 58] : [-36, -12, 0, 14, 37]
  const poseLengths = cut === 1 ? [69, 91, 78, 66, 54] : [59, 83, 91, 78, 58]
  const opacity = interpolate(frame, [0, 3, 108, 119], [0, 1, 1, 0], clamp)
  const trail = frame < 31 ? 1 : 0
  return <>
    {trail === 1 && [1, 2].map((offset) => <div key={offset} style={{ ...handShell, opacity: .13 / offset, filter: 'blur(4px)', transform: `translate(${x - sign * offset * 20}px, ${y}px) rotate(${rotate - sign * offset * 6}deg) scale(${side === 'left' ? 1 : -1},1)` }} />)}
    <div style={{ ...handShell, opacity, transform: `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${side === 'left' ? 1 : -1},1)` }}>
      <div style={palmStyle} />
      <div style={thumbStyle} />
      {poseAngles.map((angle, index) => <div key={index} style={{ ...fingerStyle, height: poseLengths[index], left: 16 + index * 29, transform: `rotate(${angle}deg)`, transition: 'none' }} />)}
      <div style={wristStyle} />
    </div>
  </>
}

const handShell: CSSProperties = { width: 170, height: 116, position: 'absolute', left: '50%', top: '50%', marginLeft: -85, marginTop: -58, transformOrigin: '50% 60%', filter: 'drop-shadow(0 22px 20px rgba(0,0,0,.36))' }
const palmStyle: CSSProperties = { width: 139, height: 75, position: 'absolute', left: 8, top: 33, borderRadius: '46% 50% 39% 45%', background: 'linear-gradient(145deg,#596071 0%,#242836 58%,#10121a 100%)', boxShadow: 'inset 0 2px rgba(255,255,255,.22), inset 0 -8px 18px rgba(0,0,0,.34)' }
const wristStyle: CSSProperties = { width: 70, height: 58, position: 'absolute', left: 126, top: 59, borderRadius: '0 24px 25px 0', background: 'linear-gradient(160deg,#292d3b,#0d0f17)', boxShadow: 'inset 0 1px rgba(255,255,255,.13)' }
const thumbStyle: CSSProperties = { width: 26, height: 82, position: 'absolute', left: 2, top: 38, borderRadius: 19, transform: 'rotate(-58deg)', transformOrigin: '50% 18%', background: 'linear-gradient(90deg,#181b26,#555c6d 45%,#171a23)', boxShadow: 'inset 2px 0 rgba(255,255,255,.12)' }
const fingerStyle: CSSProperties = { width: 23, position: 'absolute', top: 0, borderRadius: 18, transformOrigin: '50% 90%', background: 'linear-gradient(90deg,#151823,#62697b 43%,#171a24)', boxShadow: 'inset 2px 0 rgba(255,255,255,.13), inset -3px 0 rgba(0,0,0,.26)' }

function EnergyCore({ frame }: { frame: number }) {
  const { fps } = useVideoConfig()
  const born = spring({ frame: frame - 54, fps, config: { damping: 12, stiffness: 160, mass: .6 } })
  const release = interpolate(frame, [72, 89], [0, 1], clamp)
  const fade = interpolate(frame, [103, 119], [1, 0], clamp)
  const size = interpolate(born, [0, 1], [18, 178], clamp) + release * 25
  const spokes = Array.from({ length: 12 }, (_, index) => index)
  return <div style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, opacity: fade, transform: `rotate(${frame * 2.2}deg)` }}>
    <div style={{ position: 'absolute', inset: 0, border: '2px solid rgba(143,128,255,.82)', borderRadius: '50%', boxShadow: `0 0 ${38 + release * 50}px rgba(94,111,255,.62), inset 0 0 38px rgba(91,216,255,.18)` }} />
    <div style={{ position: 'absolute', inset: '18%', border: '1px solid rgba(88,216,255,.82)', borderRadius: '42% 58% 49% 51%', transform: `rotate(${-frame * 4.6}deg)`, boxShadow: '0 0 18px rgba(88,216,255,.62)' }} />
    {spokes.map((index) => <div key={index} style={{ width: 7, height: 7, position: 'absolute', left: '50%', top: '50%', margin: -3.5, borderRadius: '50%', background: index % 2 ? cyan : violet, boxShadow: `0 0 14px ${index % 2 ? cyan : violet}`, transform: `rotate(${index * 30}deg) translateX(${size * .48}px)` }} />)}
    {spokes.slice(0, 8).map((index) => <div key={`line-${index}`} style={{ width: size * .55, height: 1, position: 'absolute', left: '50%', top: '50%', transformOrigin: 'left center', transform: `rotate(${index * 45 + frame * (index % 2 ? -.5 : .7)}deg)`, background: `linear-gradient(90deg,rgba(255,255,255,.85),${index % 2 ? cyan : violet},transparent)` }} />)}
    <div style={{ position: 'absolute', inset: '38%', borderRadius: '50%', background: '#fff', boxShadow: '0 0 16px #fff, 0 0 45px #8179ff, 0 0 80px #55d7ff' }} />
  </div>
}

export function ForemanSealIntro() {
  const frame = useCurrentFrame()
  const cutFlash = [9, 19, 30].reduce((value, cut) => Math.max(value, interpolate(frame, [cut - 1, cut, cut + 2], [0, .62, 0], clamp)), 0)
  const release = interpolate(frame, [71, 83, 96], [0, 1, 0], clamp)
  const copyIn = spring({ frame: frame - 87, fps: 30, config: { damping: 15, stiffness: 125 } })
  const copyOut = interpolate(frame, [119, 131], [1, 0], clamp)
  const rayOpacity = interpolate(frame, [31, 44, 96, 110], [0, .38, .26, 0], clamp)
  return <AbsoluteFill style={{ overflow: 'hidden', background: 'radial-gradient(circle at 50% 48%,#20284f 0%,#0b0f22 34%,#03050b 75%,#010205 100%)', color: '#f9faff', fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif' }}>
    <AbsoluteFill style={{ opacity: rayOpacity, transform: `rotate(${frame * .18}deg)`, background: 'repeating-conic-gradient(from 0deg at 50% 50%,transparent 0 6deg,rgba(124,133,255,.28) 6.2deg 6.5deg,transparent 6.7deg 13deg)' }} />
    <div style={{ position: 'absolute', inset: '-18%', opacity: .5, transform: `scale(${1 + release * .08})`, background: 'radial-gradient(circle,transparent 0 17%,rgba(102,122,255,.1) 17.4% 17.7%,transparent 18% 25%,rgba(85,218,255,.08) 25.2% 25.5%,transparent 26%)' }} />
    {Array.from({ length: 22 }, (_, index) => <div key={index} style={{ width: 130 + (index % 4) * 36, height: 2, position: 'absolute', left: '50%', top: '50%', opacity: interpolate(frame, [34, 48, 92], [0, .58, .1], clamp), transformOrigin: 'left center', transform: `rotate(${index * (360 / 22) + frame * .12}deg) translateX(${90 + (index % 3) * 28}px) scaleX(${interpolate(frame, [34, 62], [.05, 1], clamp)})`, background: `linear-gradient(90deg,transparent,${index % 2 ? violet : cyan},transparent)` }} />)}
    <Hand side="left" frame={frame} />
    <Hand side="right" frame={frame} />
    <EnergyCore frame={frame} />
    <div style={{ position: 'absolute', inset: 0, opacity: cutFlash + release * .38, background: '#fff', mixBlendMode: 'screen' }} />
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: 900, height: 900, margin: -450, border: '2px solid rgba(124,132,255,.65)', borderRadius: '50%', opacity: release * .75, transform: `scale(${.12 + release * 1.4})` }} />
    <div style={{ position: 'absolute', left: '50%', bottom: 82, opacity: copyIn * copyOut, textAlign: 'center', transform: `translate(-50%,${interpolate(copyIn, [0, 1], [38, 0], clamp)}px) scale(${interpolate(copyIn, [0, 1], [.92, 1], clamp)})` }}>
      <div style={{ fontSize: 48, fontWeight: 760, letterSpacing: '-.035em', textShadow: '0 8px 30px rgba(0,0,0,.45)' }}>Model Foreman</div>
      <div style={{ marginTop: 10, color: '#b8b9cc', fontSize: 14, fontWeight: 650, letterSpacing: '.24em' }}>SEAL THE INTENT · COMMAND THE MODELS</div>
    </div>
  </AbsoluteFill>
}
