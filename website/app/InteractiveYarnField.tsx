"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type YarnBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  spin: number;
  hue: number;
  scale: number;
  cooldown: number;
};

type Burst = { id: number; x: number; y: number; hue: number };

const seeds = [
  { x: .08, y: .21, r: 92, vx: 26, vy: 17, hue: 0, spin: 4 },
  { x: .89, y: .18, r: 70, vx: -31, vy: 20, hue: 64, spin: -5 },
  { x: .94, y: .63, r: 86, vx: -25, vy: -22, hue: 139, spin: 3 },
  { x: .12, y: .72, r: 62, vx: 34, vy: -20, hue: 244, spin: -6 },
  { x: .73, y: .86, r: 53, vx: -19, vy: -28, hue: 305, spin: 7 },
  { x: .19, y: .47, r: 42, vx: 18, vy: 24, hue: 188, spin: -4 },
] as const;

export default function InteractiveYarnField() {
  const layerRef = useRef<HTMLDivElement>(null);
  const ballRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bodiesRef = useRef<YarnBody[]>([]);
  const dragRef = useRef<{ index: number; pointerId: number; dx: number; dy: number; lastX: number; lastY: number; lastAt: number } | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstIdRef = useRef(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const size = viewport();
    bodiesRef.current = seeds.map((seed) => ({
      x: seed.x * size.width,
      y: seed.y * size.height,
      vx: reducedMotion ? 0 : seed.vx,
      vy: reducedMotion ? 0 : seed.vy,
      radius: Math.max(34, Math.min(seed.r, size.width * .075)),
      rotation: seed.hue * .13,
      spin: reducedMotion ? 0 : seed.spin,
      hue: seed.hue,
      scale: 1,
      cooldown: 0,
    }));

    const explode = (index: number) => {
      const body = bodiesRef.current[index];
      if (!body || body.cooldown > 0 || reducedMotion) return;
      body.cooldown = 1.15;
      body.scale = .08;
      const id = ++burstIdRef.current;
      setBursts((current) => [...current, { id, x: body.x, y: body.y, hue: body.hue }]);
      window.setTimeout(() => setBursts((current) => current.filter((item) => item.id !== id)), 900);
      window.setTimeout(() => {
        const bounds = viewport();
        body.x = Math.max(body.radius, Math.min(bounds.width - body.radius, body.x + (Math.random() - .5) * 170));
        body.y = Math.max(body.radius, Math.min(bounds.height - body.radius, body.y + (Math.random() - .5) * 120));
        body.vx = (Math.random() - .5) * 90;
        body.vy = -20 - Math.random() * 45;
      }, 560);
    };

    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .025);
      previous = now;
      const bounds = viewport();
      const bodies = bodiesRef.current;

      for (let index = 0; index < bodies.length; index += 1) {
        const body = bodies[index];
        body.cooldown = Math.max(0, body.cooldown - dt);
        body.scale += (1 - body.scale) * Math.min(1, dt * 5.5);
        if (dragRef.current?.index !== index && !reducedMotion) {
          body.vy += 4 * dt;
          body.vx *= .999;
          body.vy *= .999;
          body.x += body.vx * dt;
          body.y += body.vy * dt;
          body.rotation += body.spin * dt;
        }

        if (body.x - body.radius < 0) { body.x = body.radius; body.vx = Math.abs(body.vx) * .88; }
        if (body.x + body.radius > bounds.width) { body.x = bounds.width - body.radius; body.vx = -Math.abs(body.vx) * .88; }
        if (body.y - body.radius < 0) { body.y = body.radius; body.vy = Math.abs(body.vy) * .88; }
        if (body.y + body.radius > bounds.height) { body.y = bounds.height - body.radius; body.vy = -Math.abs(body.vy) * .88; }

        // Keep the readable center calm while still allowing a user to drag a ball through it.
        if (dragRef.current?.index !== index) {
          const nx = (body.x - bounds.width * .5) / (bounds.width * .31);
          const ny = (body.y - bounds.height * .47) / (bounds.height * .34);
          const ellipse = nx * nx + ny * ny;
          if (ellipse < 1) {
            const length = Math.hypot(nx, ny) || 1;
            const pushX = nx / length;
            const pushY = ny / length;
            body.x += pushX * (1 - ellipse) * 18;
            body.y += pushY * (1 - ellipse) * 18;
            body.vx += pushX * 42 * dt;
            body.vy += pushY * 42 * dt;
          }
        }
      }

      for (let a = 0; a < bodies.length; a += 1) {
        for (let b = a + 1; b < bodies.length; b += 1) {
          const first = bodies[a];
          const second = bodies[b];
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const distance = Math.hypot(dx, dy) || 1;
          const minimum = first.radius * .76 + second.radius * .76;
          if (distance >= minimum) continue;
          const nx = dx / distance;
          const ny = dy / distance;
          const overlap = minimum - distance;
          first.x -= nx * overlap * .5;
          first.y -= ny * overlap * .5;
          second.x += nx * overlap * .5;
          second.y += ny * overlap * .5;
          const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
          if (relative < 0) {
            const impulse = -relative * .94;
            first.vx -= impulse * nx;
            first.vy -= impulse * ny;
            second.vx += impulse * nx;
            second.vy += impulse * ny;
            if (Math.abs(relative) > 520) explode(Math.abs(first.vx) > Math.abs(second.vx) ? a : b);
          }
        }
      }

      bodies.forEach((body, index) => {
        const element = ballRefs.current[index];
        if (!element) return;
        element.style.width = `${body.radius * 2}px`;
        element.style.height = `${body.radius * 2}px`;
        element.style.left = `${body.x}px`;
        element.style.top = `${body.y}px`;
        element.style.opacity = "1";
        element.style.transform = `translate(-50%,-50%) rotate(${body.rotation}deg) scale(${body.scale})`;
      });
      frame = requestAnimationFrame(tick);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("a,button,input,textarea,select,[role=button]")) return;
      const nearest = bodiesRef.current
        .map((body, index) => ({ index, distance: Math.hypot(event.clientX - body.x, event.clientY - body.y), body }))
        .filter(({ distance, body }) => distance <= body.radius * .92)
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) return;
      if (event.detail > 1) { explode(nearest.index); event.preventDefault(); return; }
      dragRef.current = { index: nearest.index, pointerId: event.pointerId, dx: event.clientX - nearest.body.x, dy: event.clientY - nearest.body.y, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now() };
      document.documentElement.classList.add("is-dragging-yarn");
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const body = bodiesRef.current[drag.index];
      const now = performance.now();
      const dt = Math.max(8, now - drag.lastAt) / 1000;
      body.x = event.clientX - drag.dx;
      body.y = event.clientY - drag.dy;
      body.vx = (event.clientX - drag.lastX) / dt;
      body.vy = (event.clientY - drag.lastY) / dt;
      body.rotation += (event.clientX - drag.lastX) * .18;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.lastAt = now;
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      const body = bodiesRef.current[dragRef.current.index];
      body.vx = Math.max(-900, Math.min(900, body.vx));
      body.vy = Math.max(-900, Math.min(900, body.vy));
      dragRef.current = null;
      document.documentElement.classList.remove("is-dragging-yarn");
    };

    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("pointercancel", onPointerUp, { capture: true });
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onPointerUp, { capture: true });
      document.documentElement.classList.remove("is-dragging-yarn");
    };
  }, []);

  return (
    <div className="yarn-physics-field" ref={layerRef} aria-hidden="true">
      {seeds.map((seed, index) => {
        return <div
          className="physics-yarn-ball"
          key={seed.hue}
          ref={(element) => { ballRefs.current[index] = element; }}
          style={{
            "--hue": `${seed.hue}deg`,
            width: seed.r * 2,
            height: seed.r * 2,
            left: `${seed.x * 100}vw`,
            top: `${seed.y * 100}vh`,
            opacity: 1,
            transform: `translate(-50%,-50%) rotate(${seed.hue * .13}deg)`,
          } as CSSProperties}
        />;
      })}
      {bursts.map((burst) => (
        <span className="yarn-burst" key={burst.id} style={{ left: burst.x, top: burst.y, "--burst-hue": `${burst.hue}deg` } as CSSProperties}>
          {Array.from({ length: 18 }, (_, index) => <i key={index} style={{ "--ray": index, "--distance": `${78 + (index % 5) * 18}px` } as CSSProperties} />)}
        </span>
      ))}
      <div className="yarn-play-hint"><span>↗</span><b>拖动毛线团</b><i>碰撞 · 双击爆散</i></div>
    </div>
  );
}
