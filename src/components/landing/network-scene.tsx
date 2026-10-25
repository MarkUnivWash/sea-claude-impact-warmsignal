"use client";

import { useEffect, useRef } from "react";

/**
 * Hero visual: a slowly turning globe of people (nodes) joined by faint ties. Warm "signals" hop
 * along the ties, and each node flares warm when a signal reaches it.
 * three.js is imported inside the effect so it never runs on the server and stays out of the
 * main bundle. Rendering pauses when the hero is off screen or the tab is hidden.
 */
export function NetworkScene({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    import("three").then((THREE) => {
      if (disposed) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      const dpr = Math.min(window.devicePixelRatio, 2);
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x000000, 0);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 17);
      const world = new THREE.Group();
      scene.add(world);

      // Deterministic pseudo-random so the network looks the same on every visit.
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

      // Nodes on a jittered Fibonacci sphere.
      const N = 170;
      const pos: InstanceType<typeof THREE.Vector3>[] = [];
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = i * Math.PI * (3 - Math.sqrt(5));
        const radius = 5.2 + rand() * 1.6;
        pos.push(
          new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r)
            .multiplyScalar(radius)
            .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.6)),
        );
      }

      // Each node links to its nearest neighbours.
      const adj: number[][] = pos.map(() => []);
      const edgeKey = new Set<string>();
      const edges: [number, number][] = [];
      pos.forEach((p, i) => {
        const near = pos
          .map((q, j) => [j, p.distanceToSquared(q)] as const)
          .filter(([j]) => j !== i)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3);
        for (const [j] of near) {
          const k = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (edgeKey.has(k)) continue;
          edgeKey.add(k);
          edges.push([i, j]);
          adj[i].push(j);
          adj[j].push(i);
        }
      });

      const lineGeo = new THREE.BufferGeometry().setFromPoints(edges.flatMap(([a, b]) => [pos[a], pos[b]]));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x818cf8,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      world.add(new THREE.LineSegments(lineGeo, lineMat));

      // Round, soft points whose colour shifts from cool indigo to warm amber with "heat".
      const pointMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uPixelRatio: { value: dpr },
          uCold: { value: new THREE.Color(0x8b8ff0) },
          uWarm: { value: new THREE.Color(0xffb27a) },
        },
        vertexShader: /* glsl */ `
          attribute float size;
          attribute float heat;
          uniform float uPixelRatio;
          varying float vHeat;
          varying float vDepth;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = size * (1.0 + heat * 1.4) * uPixelRatio * (18.0 / -mv.z);
            vHeat = heat;
            vDepth = smoothstep(-24.0, -11.0, mv.z);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uCold;
          uniform vec3 uWarm;
          varying float vHeat;
          varying float vDepth;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float glow = smoothstep(0.5, 0.0, d);
            float core = smoothstep(0.16, 0.0, d);
            vec3 col = mix(uCold, uWarm, vHeat);
            float a = (glow * 0.55 + core) * (0.25 + 0.75 * vDepth);
            gl_FragColor = vec4(col * a, a);
          }`,
      });

      const nodeGeo = new THREE.BufferGeometry().setFromPoints(pos);
      const sizes = new Float32Array(N).map(() => 7 + rand() * 6);
      for (let i = 0; i < 12; i++) sizes[Math.floor(rand() * N)] = 16; // a few well-connected hubs
      const heat = new Float32Array(N);
      nodeGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
      nodeGeo.setAttribute("heat", new THREE.BufferAttribute(heat, 1));
      world.add(new THREE.Points(nodeGeo, pointMat));

      // Signals: each travels one tie, lights up the node it reaches, then hops onward.
      const P = 26;
      type Pulse = { from: number; to: number; t: number; speed: number };
      const pulses: Pulse[] = Array.from({ length: P }, () => {
        const from = Math.floor(rand() * N);
        return { from, to: adj[from][Math.floor(rand() * adj[from].length)], t: rand(), speed: 0.45 + rand() * 0.5 };
      });
      const pulsePos = new Float32Array(P * 3);
      const pulseGeo = new THREE.BufferGeometry();
      pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
      pulseGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(P).fill(9), 1));
      pulseGeo.setAttribute("heat", new THREE.BufferAttribute(new Float32Array(P).fill(1), 1));
      world.add(new THREE.Points(pulseGeo, pointMat));

      const tmp = new THREE.Vector3();
      function step(dt: number) {
        for (let i = 0; i < N; i++) heat[i] = Math.max(0, heat[i] - dt * 0.9);
        pulses.forEach((p, i) => {
          p.t += dt * p.speed;
          if (p.t >= 1) {
            heat[p.to] = 1;
            const next = adj[p.to].filter((j) => j !== p.from);
            p.from = p.to;
            p.to = (next.length ? next : adj[p.to])[Math.floor(rand() * (next.length || adj[p.to].length))];
            p.t = 0;
          }
          tmp.lerpVectors(pos[p.from], pos[p.to], p.t);
          pulsePos.set([tmp.x, tmp.y, tmp.z], i * 3);
        });
        nodeGeo.attributes.heat.needsUpdate = true;
        pulseGeo.attributes.position.needsUpdate = true;
      }

      // Gentle parallax toward the pointer.
      const target = { x: 0, y: 0 };
      const onPointer = (e: PointerEvent) => {
        target.x = (e.clientX / window.innerWidth - 0.5) * 0.5;
        target.y = (e.clientY / window.innerHeight - 0.5) * 0.35;
      };
      window.addEventListener("pointermove", onPointer);

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = el;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        camera.aspect = w / Math.max(h, 1);
        // Pull the camera back on narrow screens so the globe still fits.
        camera.position.z = camera.aspect < 1 ? 17 / Math.max(camera.aspect, 0.55) : 17;
        camera.updateProjectionMatrix();
        if (reduceMotion) renderer.render(scene, camera);
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();

      let visible = true;
      const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
      io.observe(el);

      let raf = 0;
      let last = performance.now();
      let spin = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        if (!visible || document.hidden) return;
        spin += dt * 0.06;
        world.rotation.y = spin + (world.rotation.y - spin) * 0.95 + target.x * 0.05;
        world.rotation.x += (0.18 + target.y - world.rotation.x) * 0.04;
        step(dt);
        renderer.render(scene, camera);
      };

      if (reduceMotion) {
        world.rotation.set(0.18, 0.6, 0);
        step(0);
        renderer.render(scene, camera);
      } else {
        raf = requestAnimationFrame(loop);
      }
      requestAnimationFrame(() => el.setAttribute("data-ready", ""));

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener("pointermove", onPointer);
        lineGeo.dispose();
        nodeGeo.dispose();
        pulseGeo.dispose();
        lineMat.dispose();
        pointMat.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden
      className={`opacity-0 transition-opacity duration-[1500ms] data-[ready]:opacity-100 ${className}`}
    />
  );
}
