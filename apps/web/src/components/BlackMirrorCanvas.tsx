/**
 * BlackMirrorCanvas — o espelho de dados (shader WebGL).
 *
 * Túnel fractal cristalino frio (estética da tela de loading do Control):
 * profundidade em perspectiva, turbulência (domain warp evolutivo), bloom
 * compacto + streaks anamórficos que piscam em pulso mid-tempo através de uma
 * névoa, e pegada CRT (curvatura + aberração + scanlines + grille).
 *
 * Pipeline multi-passe: cena → bright → blur → streaks → composite. Ruído
 * tileable no eixo angular elimina a costura do atan. Pausa quando a aba está
 * oculta; redimensiona ao container via ResizeObserver. Sem dependências.
 *
 * Origem: docs/black-mirror/preview.html (iterado com o usuário 2026-06-16).
 */
import { useEffect, useRef } from 'react'

// ── knobs (mesmos valores travados no preview) ──────────────────────────────
const BPM = 84            // pulso lento mid-tempo
const HALF_TIME = true    // pisca no meio-tempo → hipnótico
const PULSE_BASE = 0.0    // glow OFF entre batidas — começa zerado
const PULSE_AMP = 0.7     // pisca um pouco mais forte
const PULSE_DECAY = 3.5   // swell lento (menor = permanece mais)
const BLOOM_I = 0.9       // glow compacto (raio no passe de blur)
const STREAK_I = 1.2      // rays longos trazidos pra frente
const FOG_I = 1.3         // névoa que o glow atravessa
const CRT_I = 1.0         // dose do CRT (curvatura + aberração + scanlines + grille)
const BLOOM_DIV = 2       // buffers de bloom/streak em 1/2 res
const BLUR_SCALE = 0.42   // raio do glow

const VS = `attribute vec2 p; varying vec2 v_uv;
void main(){ v_uv = 0.5*(p+1.0); gl_Position = vec4(p,0.0,1.0); }`

const FS_SCENE = `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_pulse;
const float NARMS = 3.0;
float h(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float pnoise(vec2 p, float per){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  float x0=mod(i.x, per), x1=mod(i.x+1.0, per);
  float a=h(vec2(x0,i.y)), b=h(vec2(x1,i.y));
  float c=h(vec2(x0,i.y+1.0)), d=h(vec2(x1,i.y+1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float pfbm(vec2 p, float per){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*pnoise(p,per); p*=2.0; per*=2.0; a*=0.5; } return s; }
float prfbm(vec2 p, float per){ float s=0.0,a=0.5; for(int i=0;i<6;i++){ float n=pnoise(p,per); n=1.0-abs(2.0*n-1.0); n*=n; s+=a*n; p*=2.0; per*=2.0; a*=0.55; } return s; }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  float r = length(uv)+1e-4;
  float theta = atan(uv.y,uv.x) * 0.1591549431;
  float t = u_time;
  theta += t*0.012;
  float depth = 1.0/(r + 0.14);
  float fall  = depth - t*0.35;
  vec2 base = vec2(theta*NARMS + 0.45*depth, fall);
  float ev = t*0.10;
  vec2 e1 = ev*vec2( 0.70, 0.55);
  vec2 e2 = ev*vec2(-0.50, 0.80);
  vec2 q = vec2(pfbm(base + e1, NARMS), pfbm(base + vec2(5.2,1.3) + e2, NARMS));
  vec2 w = vec2(pfbm(base*2.0 + 2.0*q + e2 + vec2(8.0,2.0), NARMS*2.0),
                pfbm(base*2.0 + 2.0*q + e1 + vec2(1.0,9.0), NARMS*2.0));
  float cryst = prfbm(base*3.0 + 2.7*w + ev*vec2(0.30,-0.22), NARMS*3.0); cryst = pow(cryst,1.9);
  float glint = smoothstep(0.62,0.95, prfbm(base*5.0 + 3.3*w + ev*vec2(-0.26,0.34), NARMS*5.0));
  float core  = smoothstep(0.85,0.0,r);
  float pools = pfbm(base*vec2(1.0,0.7) + 0.04*t, NARMS);
  float light = core*(0.30+0.70*pools);
  float near = smoothstep(0.06, 0.85, r);
  cryst *= mix(0.55, 1.0, near);
  glint *= near;
  float v = cryst*1.31 + light*1.05 + glint*0.5;
  vec3 deep=vec3(0.008,0.022,0.027), mid=vec3(0.024,0.066,0.078), hi=vec3(0.760,0.880,0.920);
  vec3 col = mix(deep,mid, smoothstep(0.0,0.65,v));
  col = mix(col, hi, smoothstep(0.72,1.30,v)*0.95);
  col += hi*core*core*(0.02 + 0.14*u_pulse);
  col *= smoothstep(1.30,0.18,r);
  gl_FragColor = vec4(col,1.0);
}`

const FS_BRIGHT = `precision highp float;
uniform sampler2D u_tex; varying vec2 v_uv;
void main(){
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float l = dot(c, vec3(0.299,0.587,0.114));
  float k = smoothstep(0.50, 0.78, l);
  gl_FragColor = vec4(c*k, 1.0);
}`

const FS_BLUR = `precision highp float;
uniform sampler2D u_tex; uniform vec2 u_dir; varying vec2 v_uv;
void main(){
  vec3 c = texture2D(u_tex, v_uv).rgb * 0.2270270270;
  c += (texture2D(u_tex, v_uv + u_dir*1.3846153846).rgb + texture2D(u_tex, v_uv - u_dir*1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(u_tex, v_uv + u_dir*3.2307692308).rgb + texture2D(u_tex, v_uv - u_dir*3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c,1.0);
}`

const FS_STREAK = `precision highp float;
uniform sampler2D u_tex; uniform vec2 u_texel; varying vec2 v_uv;
const int SAMPLES = 30;
vec3 ray(vec2 dir, float decay, float step){
  vec3 acc=vec3(0.0); float w=1.0, tot=0.0;
  for(int i=1;i<=SAMPLES;i++){
    float fi=float(i); vec2 off=dir*fi*step;
    acc += texture2D(u_tex, v_uv+off).rgb * w;
    acc += texture2D(u_tex, v_uv-off).rgb * w;
    tot += 2.0*w; w *= decay;
  }
  return acc/tot;
}
void main(){
  vec2 tx = u_texel;
  vec3 s = vec3(0.0);
  s += ray(vec2(tx.x,0.0),        0.95, 8.0) * 1.20;
  s += ray(vec2(0.0,tx.y),        0.91, 7.0) * 0.55;
  s += ray(vec2(tx.x,tx.y)*0.707, 0.91, 7.0) * 0.50;
  s += ray(vec2(tx.x,-tx.y)*0.707,0.91, 7.0) * 0.50;
  gl_FragColor = vec4(s,1.0);
}`

const FS_COMP = `precision highp float;
uniform sampler2D u_scene, u_bloom, u_streak;
uniform float u_bloomI, u_streakI, u_fogI, u_pulse, u_time, u_crt;
varying vec2 v_uv;
float hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.0; a*=0.5; } return s; }
void main(){
  vec2 cc = v_uv*2.0 - 1.0;
  cc *= 1.0 + 0.06*u_crt*dot(cc,cc);
  cc *= 1.0/(1.0 + 0.12*u_crt);
  vec2 uv = cc*0.5 + 0.5;

  vec2 dir = uv - 0.5;
  float ca = (0.0016 + 0.004*dot(dir,dir)) * u_crt;
  vec3 scene;
  scene.r = texture2D(u_scene, uv + dir*ca).r;
  scene.g = texture2D(u_scene, uv).g;
  scene.b = texture2D(u_scene, uv - dir*ca).b;

  vec3 bloom  = texture2D(u_bloom,  uv).rgb;
  vec3 streak = texture2D(u_streak, uv).rgb;
  vec3 glow = bloom*u_bloomI + streak*vec3(0.74,0.88,1.0)*u_streakI;

  float mist = fbm(uv*vec2(5.0,4.0) + vec2(u_time*0.03, u_time*0.018));
  mist = smoothstep(0.25, 0.95, mist);
  float glowAmt = dot(glow, vec3(0.333));
  vec3 fog = vec3(0.55,0.78,1.0) * mist * glowAmt * u_fogI;

  vec3 col = scene + (glow + fog) * u_pulse;
  col = col/(col+0.60)*1.30;

  float scan    = 1.0 - 0.16*u_crt*(0.5 + 0.5*sin(gl_FragCoord.y*2.0));
  vec3  grille  = 1.0 - 0.10*u_crt*(0.5 + 0.5*vec3(
                    sin(gl_FragCoord.x*2.0944),
                    sin(gl_FragCoord.x*2.0944 + 2.0944),
                    sin(gl_FragCoord.x*2.0944 + 4.1888)));
  float flicker = 1.0 - 0.025*u_crt*sin(u_time*48.0);
  col *= scan * flicker;
  col *= grille;

  float vig = smoothstep(1.30, 0.35, length(dir)*1.4);
  col *= mix(1.0, vig, 0.55*u_crt);

  float g = hash(gl_FragCoord.xy + fract(u_time))*0.05 - 0.025;
  col += g;
  gl_FragColor = vec4(col,1.0);
}`

export function BlackMirrorCanvas({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        // eslint-disable-next-line no-console
        console.warn('[black-mirror] shader:', gl.getShaderInfoLog(s))
      }
      return s
    }
    const program = (fs: string) => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(p)
      return p
    }
    const P = {
      scene: program(FS_SCENE),
      bright: program(FS_BRIGHT),
      blur: program(FS_BLUR),
      streak: program(FS_STREAK),
      comp: program(FS_COMP),
    }

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const bindQuad = (prog: WebGLProgram) => {
      const l = gl.getAttribLocation(prog, 'p')
      gl.enableVertexAttribArray(l)
      gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0)
    }

    type RT = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
    const makeRT = (w: number, h: number): RT => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return { tex, fbo, w, h }
    }
    let RT: Record<string, RT> = {}
    const alloc = () => {
      for (const k in RT) { gl.deleteTexture(RT[k].tex); gl.deleteFramebuffer(RT[k].fbo) }
      const W = canvas.width, H = canvas.height
      const bw = Math.max(1, (W / BLOOM_DIV) | 0), bh = Math.max(1, (H / BLOOM_DIV) | 0)
      RT = {
        scene: makeRT(W, H), bright: makeRT(bw, bh),
        pingA: makeRT(bw, bh), pingB: makeRT(bw, bh), streak: makeRT(bw, bh),
      }
    }
    // Mede o próprio canvas (clientWidth/Height): funciona tanto em tela cheia
    // (fixed inset:0 → viewport) quanto em painel. A auto-cura no loop cobre o
    // caso de 0px no mount, antes do layout.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cw = Math.max(1, canvas.clientWidth)
      const ch = Math.max(1, canvas.clientHeight)
      const w = Math.max(1, Math.floor(cw * dpr))
      const h = Math.max(1, Math.floor(ch * dpr))
      if (canvas.width === w && canvas.height === h && RT.scene) return
      canvas.width = w; canvas.height = h
      alloc()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const pass = (prog: WebGLProgram, target: RT | null) => {
      gl.useProgram(prog); bindQuad(prog)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
      gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height)
    }
    const tex = (prog: WebGLProgram, name: string, t: WebGLTexture, unit: number) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t)
      gl.uniform1i(gl.getUniformLocation(prog, name), unit)
    }
    const u = (prog: WebGLProgram, name: string) => gl.getUniformLocation(prog, name)

    let raf = 0
    let start = performance.now()
    let elapsed = 0
    let running = true

    const frame = (now: number) => {
      if (!running) return
      // Auto-cura: se o canvas ainda está sem tamanho real (mount antes do
      // layout), remede antes de desenhar — evita o frame 1px esticado branco.
      if (canvas.width < 2 || canvas.height < 2 || !RT.scene) resize()
      elapsed = (now - start) / 1000
      const rate = (BPM / 60) * (HALF_TIME ? 0.5 : 1.0)
      const ph = (elapsed * rate) % 1.0
      const env = Math.exp(-PULSE_DECAY * ph)
      const pulse = PULSE_BASE + PULSE_AMP * env

      // 1) scene
      pass(P.scene, RT.scene)
      gl.uniform2f(u(P.scene, 'u_res'), RT.scene.w, RT.scene.h)
      gl.uniform1f(u(P.scene, 'u_time'), elapsed)
      gl.uniform1f(u(P.scene, 'u_pulse'), pulse)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 2) bright
      pass(P.bright, RT.bright); tex(P.bright, 'u_tex', RT.scene.tex, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 3) blur (1 pass, tight)
      const tH = 1 / RT.bright.w, tV = 1 / RT.bright.h
      pass(P.blur, RT.pingA); tex(P.blur, 'u_tex', RT.bright.tex, 0)
      gl.uniform2f(u(P.blur, 'u_dir'), tH * BLUR_SCALE, 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
      pass(P.blur, RT.pingB); tex(P.blur, 'u_tex', RT.pingA.tex, 0)
      gl.uniform2f(u(P.blur, 'u_dir'), 0, tV * BLUR_SCALE); gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 4) streaks
      pass(P.streak, RT.streak); tex(P.streak, 'u_tex', RT.bright.tex, 0)
      gl.uniform2f(u(P.streak, 'u_texel'), 1 / RT.bright.w, 1 / RT.bright.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 5) composite → screen
      pass(P.comp, null)
      tex(P.comp, 'u_scene', RT.scene.tex, 0)
      tex(P.comp, 'u_bloom', RT.pingB.tex, 1)
      tex(P.comp, 'u_streak', RT.streak.tex, 2)
      gl.uniform1f(u(P.comp, 'u_bloomI'), BLOOM_I)
      gl.uniform1f(u(P.comp, 'u_streakI'), STREAK_I)
      gl.uniform1f(u(P.comp, 'u_fogI'), FOG_I)
      gl.uniform1f(u(P.comp, 'u_crt'), CRT_I)
      gl.uniform1f(u(P.comp, 'u_pulse'), pulse)
      gl.uniform1f(u(P.comp, 'u_time'), elapsed)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const onVis = () => {
      running = !document.hidden
      if (running) { start = performance.now() - elapsed * 1000; raf = requestAnimationFrame(frame) }
      else cancelAnimationFrame(raf)
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      // NÃO chamar loseContext(): em StrictMode (dev) o componente monta 2x no
      // MESMO canvas; perder o contexto no 1º cleanup deixa o 2º mount (o que
      // fica na tela) com contexto morto → render branco. Só liberamos os
      // recursos; o contexto é coletado quando o canvas sai do DOM.
      try {
        for (const k in RT) { gl.deleteTexture(RT[k].tex); gl.deleteFramebuffer(RT[k].fbo) }
        gl.deleteBuffer(buf)
        ;(Object.values(P) as WebGLProgram[]).forEach(p => gl.deleteProgram(p))
      } catch { /* contexto pode já ter ido — ok */ }
    }
  }, [])

  // background dark de base — se o WebGL falhar/atrasar, fica escuro (nunca branco).
  return <canvas ref={canvasRef} className={className} style={{ display: 'block', width: '100%', height: '100%', background: '#04080a', ...style }} />
}
