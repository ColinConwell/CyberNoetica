import * as THREE from 'three';
import type { JourneyEndpoint } from './endpoint.js';
import type { TransitionLook } from './types.js';
import { quintic } from './definition.js';

// Shared by heads and traces: fixed correspondence, live endpoints, zero endpoint displacement/velocity.
const flightShader = `
float ease(float p){return p*p*p*(p*(p*6.-15.)+10.);}
float envelopeAt(float p){return 16.*p*p*(1.-p)*(1.-p);}
vec3 flight(float p){
  float s=ease(p), e=envelopeAt(p), id=float(gl_InstanceID);
  vec3 q=mix(sourcePosition,targetPosition,s);
  vec2 d=(targetPosition.xy-sourcePosition.xy)*vec2(aspect,1.);
  if(pathMode>0.5 && pathMode<1.5) q.xy+=e*curvature*vec2(-d.y/aspect,d.x)*.5;
  if(pathMode>1.5){
    float angle=e*curvature*3.14159;
    vec2 v=q.xy*vec2(aspect,1.);
    q.xy=vec2(cos(angle)*v.x-sin(angle)*v.y,sin(angle)*v.x+cos(angle)*v.y)/vec2(aspect,1.);
  }
  vec2 v=q.xy;
  q.xy+=e*(swirl*vec2(-v.y/aspect,v.x*aspect)+spread*vec2(cos(id*2.39996+time)/aspect,sin(id*2.39996+time))*.35);
  q.x+=e*spread*sin(time*.7+q.y*3.)*.08/aspect;
  return q;
}`;

export class JourneyPresentation {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private traceGeometry: THREE.InstancedBufferGeometry;
  private traceMaterial: THREE.ShaderMaterial;
  private traces: THREE.Mesh;
  private targetPositions: Float32Array;
  private targetColors: Float32Array;
  private quadScene = new THREE.Scene();
  private quadMaterial: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private slotTarget: THREE.WebGLRenderTarget | null = null;
  private nativeTarget: THREE.WebGLRenderTarget | null = null;
  private width = 1280;
  private height = 720;
  private style = 1;
  private handoff: THREE.WebGLRenderTarget | null = null;
  private handoffRemaining = 0;
  private clearColor = new THREE.Color();
  constructor(
    readonly count: number,
    style: 'character' | 'unified' = 'character',
  ) {
    this.style = Number(style === 'character');
    this.targetPositions = new Float32Array(count * 3);
    this.targetColors = new Float32Array(count * 4);
    this.geometry = new THREE.InstancedBufferGeometry();
    (this.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
        ]),
        3,
      ),
    );
    for (const [name, size] of [
      ['sourcePosition', 3],
      ['targetPosition', 3],
      ['sourceColor', 4],
      ['targetColor', 4],
      ['tangent', 3],
      ['targetTangent', 3],
    ] as const)
      this.geometry.setAttribute(
        name,
        new THREE.InstancedBufferAttribute(
          new Float32Array(count * size),
          size,
        ).setUsage(THREE.DynamicDrawUsage),
      );
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        pathMode: { value: 0 },
        curvature: { value: 0.35 },
        renderMode: { value: 0 },
        traceLength: { value: 0.12 },
        progress: { value: 0 },
        opacity: { value: 1 },
        time: { value: 0 },
        swirl: { value: 0 },
        spread: { value: 0 },
        light: { value: 0 },
        pointSize: { value: 3 },
        resolution: { value: new THREE.Vector2(1280, 720) },
        aspect: { value: 1280 / 720 },
        pan: { value: new THREE.Vector2() },
        zoom: { value: 1 },
      },
      vertexShader: `attribute vec3 sourcePosition,targetPosition;attribute vec4 sourceColor,targetColor;attribute vec3 tangent,targetTangent;
      uniform float progress,opacity,time,swirl,spread,light,pointSize,aspect,zoom,pathMode,curvature,renderMode,traceLength;uniform vec2 pan,resolution;varying vec4 color;varying vec2 sprite;
      ${flightShader}
      void main(){float p=clamp(progress,0.,1.);float s=ease(p);vec3 q=flight(p);
      color=mix(sourceColor,targetColor,s);color.a*=opacity;color.rgb*=1.+light;
      vec2 direction=mix(tangent.xy,targetTangent.xy,s);float ribbon=clamp(length(direction),0.,1.);
      vec2 velocity=(flight(min(1.,p+.005)).xy-flight(max(0.,p-.005)).xy)*resolution*zoom;
      float stretch=0.;
      if(renderMode>.5 && renderMode<1.5){direction=velocity/resolution;stretch=min(40.,length(velocity)*traceLength*5.);}
      direction=length(direction)>.001?normalize(direction*resolution):vec2(1.,0.);vec2 perpendicular=vec2(-direction.y,direction.x);
      vec2 size=vec2(mix(pointSize,12.,ribbon)+stretch,pointSize);
      vec2 offset=(direction*position.x*size.x+perpendicular*position.y*size.y)*2./resolution;
      sprite=position.xy;gl_Position=vec4((q.xy+pan)*zoom+offset,0.,1.);}`,
      fragmentShader: `varying vec4 color;varying vec2 sprite;void main(){float r=dot(sprite,sprite);if(r>1.)discard;float glow=exp(-r*4.);gl_FragColor=vec4(color.rgb,color.a*glow*.55);}`,
    });
    const points = new THREE.Mesh(this.geometry, this.material);
    points.frustumCulled = false;
    this.traceGeometry = new THREE.InstancedBufferGeometry();
    this.traceGeometry.instanceCount = count;
    // Eight ribbon segments per sample; no per-frame history allocation or extra target textures.
    const vertices: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8,
        b = (i + 1) / 8;
      vertices.push(a, -1, 0, b, -1, 0, b, 1, 0, a, -1, 0, b, 1, 0, a, 1, 0);
    }
    this.traceGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    for (const [name, attribute] of Object.entries(this.geometry.attributes))
      if (name !== 'position') this.traceGeometry.setAttribute(name, attribute);
    this.traceMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.material.uniforms,
      vertexShader: `attribute vec3 sourcePosition,targetPosition;attribute vec4 sourceColor,targetColor;
      uniform float progress,opacity,time,swirl,spread,light,pointSize,aspect,zoom,pathMode,curvature,traceLength;
      uniform vec2 pan,resolution;varying vec4 color;varying vec2 ribbon;
      ${flightShader}
      void main(){
        float p=clamp(progress-position.x*traceLength,0.,1.);
        vec2 q=flight(p).xy;
        vec2 velocity=(flight(min(1.,p+.001)).xy-flight(max(0.,p-.001)).xy)*resolution;
        vec2 direction=length(velocity)>.00001?normalize(velocity):vec2(1.,0.);
        vec2 offset=vec2(-direction.y,direction.x)*position.y*pointSize*.55*2./resolution;
        color=mix(sourceColor,targetColor,ease(p));
        color.rgb*=1.+light;
        color.a*=opacity*envelopeAt(progress)*(1.-position.x)*.3;
        ribbon=position.xy;gl_Position=vec4((q+pan)*zoom+offset,0.,1.);
      }`,
      fragmentShader: `varying vec4 color;varying vec2 ribbon;void main(){gl_FragColor=vec4(color.rgb,color.a*exp(-ribbon.y*ribbon.y*3.));}`,
    });
    this.traces = new THREE.Mesh(this.traceGeometry, this.traceMaterial);
    this.traces.frustumCulled = false;
    this.traces.visible = false;
    this.scene.add(this.traces, points);
    this.quadMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
      uniforms: {
        image: { value: null },
        opacity: { value: 1 },
        offset: { value: new THREE.Vector2() },
        scale: { value: 1 },
        rotation: { value: 0 },
        aspect: { value: 1280 / 720 },
      },
      vertexShader: `varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `uniform sampler2D image;uniform float opacity,scale,rotation,aspect;uniform vec2 offset;varying vec2 uv0;void main(){vec2 q=(uv0*2.-1.-offset)/scale;q.x*=aspect;float c=cos(rotation),s=sin(rotation);q=mat2(c,-s,s,c)*q;q.x/=aspect;vec2 uv=q*.5+.5;if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;gl_FragColor=texture2D(image,uv)*opacity;}`,
    });
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.quadMaterial,
    );
    this.quadScene.add(this.quad);
  }
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.slotTarget?.setSize(width, height);
    this.nativeTarget?.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
    this.quadMaterial.uniforms.aspect.value = width / Math.max(1, height);
    this.material.uniforms.aspect.value = width / Math.max(1, height);
    this.material.uniforms.pointSize.value = Math.max(
      2,
      Math.min(6, height / 230),
    );
  }
  update(
    source: JourneyEndpoint,
    target: JourneyEndpoint | null,
    map: Uint32Array | null,
    progress: number,
    time: number,
    guidance: { swirl: number; spread: number; light: number },
    style: 'character' | 'unified',
    dt: number,
    view: { panX: number; panY: number; zoom: number },
    look?: TransitionLook,
    reduceMotion = false,
  ): void {
    this.material.uniforms.pathMode.value =
      look?.path === 'arc' ? 1 : look?.path === 'vortex' ? 2 : 0;
    this.material.uniforms.curvature.value =
      (look?.curvature ?? 0) * (reduceMotion ? 0.25 : 1);
    this.material.uniforms.renderMode.value =
      look?.rendering === 'streaks' ? 1 : 0;
    this.material.uniforms.traceLength.value =
      (look?.traceLength ?? 0.12) * (reduceMotion ? 0.25 : 1);
    this.traces.visible =
      look?.rendering === 'traces' && progress > 0 && progress < 1;
    this.handoffRemaining = Math.max(0, this.handoffRemaining - dt);
    if (this.handoffRemaining === 0 && this.handoff) {
      this.handoff.dispose();
      this.handoff = null;
    }
    this.style +=
      (Number(style === 'character') - this.style) *
      (dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.1));
    const destination = target ?? source;
    for (let i = 0; i < this.count; i++) {
      const j = map?.[i] ?? i;
      for (let a = 0; a < 3; a++)
        this.targetPositions[i * 3 + a] = destination.positions[j * 3 + a];
      for (let a = 0; a < 3; a++)
        (this.geometry.attributes.targetTangent.array as Float32Array)[
          i * 3 + a
        ] = destination.tangents[j * 3 + a];
      for (let a = 0; a < 4; a++)
        this.targetColors[i * 4 + a] = destination.colors[j * 4 + a];
    }
    const attributes = this.geometry.attributes;
    (attributes.sourcePosition.array as Float32Array).set(source.positions);
    (attributes.targetPosition.array as Float32Array).set(this.targetPositions);
    (attributes.sourceColor.array as Float32Array).set(source.colors);
    (attributes.targetColor.array as Float32Array).set(this.targetColors);
    (attributes.tangent.array as Float32Array).set(source.tangents);
    for (const [name, attribute] of Object.entries(attributes))
      if (name !== 'position') attribute.needsUpdate = true;
    Object.assign(this.material.uniforms.progress, { value: progress });
    this.material.uniforms.time.value = time;
    for (const key of ['swirl', 'spread', 'light'] as const)
      this.material.uniforms[key].value = guidance[key];
    this.material.uniforms.pan.value.set(view.panX, view.panY);
    this.material.uniforms.zoom.value = view.zoom;
  }
  private native(
    renderer: THREE.WebGLRenderer,
    endpoint: JourneyEndpoint,
  ): void {
    this.slotTarget ??= new THREE.WebGLRenderTarget(this.width, this.height);
    this.nativeTarget ??= new THREE.WebGLRenderTarget(this.width, this.height);
    renderer.setRenderTarget(this.nativeTarget);
    renderer.clear();
    for (const slot of endpoint.slots) {
      renderer.setRenderTarget(this.slotTarget);
      renderer.clear();
      renderer.render(slot.scene, slot.camera);
      const u = this.quadMaterial.uniforms;
      u.image.value = this.slotTarget.texture;
      u.opacity.value = slot.layer.opacity;
      u.offset.value.set(slot.layer.x, slot.layer.y);
      u.scale.value = slot.layer.scale;
      u.rotation.value = slot.layer.rotation;
      renderer.setRenderTarget(this.nativeTarget);
      renderer.render(this.quadScene, this.camera);
    }
  }
  beginHandoff(
    renderer: THREE.WebGLRenderer,
    source: JourneyEndpoint,
    target: JourneyEndpoint | null,
    progress: number,
    view: { panX: number; panY: number; zoom: number },
  ): void {
    const previous = renderer.getRenderTarget(),
      capture = new THREE.WebGLRenderTarget(this.width, this.height);
    renderer.setRenderTarget(capture);
    try {
      this.render(renderer, source, target, progress, view);
    } finally {
      renderer.setRenderTarget(previous);
    }
    this.handoff?.dispose();
    this.handoff = capture;
    this.handoffRemaining = 0.3;
  }
  captureScene(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    const previous = renderer.getRenderTarget(),
      capture = new THREE.WebGLRenderTarget(this.width, this.height);
    renderer.setRenderTarget(capture);
    try {
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    this.handoff?.dispose();
    this.handoff = capture;
    this.handoffRemaining = 0.3;
  }
  takeHandoff(): THREE.WebGLRenderTarget | null {
    const target = this.handoff;
    this.handoff = null;
    return target;
  }
  adoptHandoff(target: THREE.WebGLRenderTarget | null): void {
    this.handoff = target;
    this.handoffRemaining = target ? 0.3 : 0;
  }
  render(
    renderer: THREE.WebGLRenderer,
    source: JourneyEndpoint | null,
    target: JourneyEndpoint | null,
    progress: number,
    view: { panX: number; panY: number; zoom: number },
  ): void {
    if (!source) return;
    const previous = renderer.getRenderTarget(),
      auto = renderer.autoClear,
      alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    try {
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      let nativeOpacity =
        this.style *
        (target
          ? progress < 0.15
            ? 1 - quintic(progress / 0.15)
            : progress > 0.85
              ? quintic((progress - 0.85) / 0.15)
              : 0
          : 1);
      const nativeEndpoint = target && progress > 0.5 ? target : source;
      if (
        nativeEndpoint.stop.composition === 'blend' &&
        nativeEndpoint.slots.length > 1
      )
        nativeOpacity = 0;
      if (nativeOpacity > 0.001) {
        this.native(renderer, nativeEndpoint);
        renderer.setRenderTarget(previous);
        renderer.clear();
        const u = this.quadMaterial.uniforms;
        u.image.value = this.nativeTarget!.texture;
        u.opacity.value = nativeOpacity;
        u.offset.value.set(view.panX * view.zoom, view.panY * view.zoom);
        u.scale.value = view.zoom;
        u.rotation.value = 0;
        renderer.render(this.quadScene, this.camera);
      } else {
        renderer.setRenderTarget(previous);
        renderer.clear();
      }
      this.material.uniforms.opacity.value = 1 - nativeOpacity;
      if (nativeOpacity < 0.999) renderer.render(this.scene, this.camera);
      if (this.handoff && this.handoffRemaining > 0) {
        const u = this.quadMaterial.uniforms;
        u.image.value = this.handoff.texture;
        u.opacity.value = quintic(this.handoffRemaining / 0.3);
        u.offset.value.set(0, 0);
        u.scale.value = 1;
        u.rotation.value = 0;
        renderer.render(this.quadScene, this.camera);
      }
    } finally {
      renderer.setRenderTarget(previous);
      renderer.autoClear = auto;
      renderer.setClearColor(this.clearColor, alpha);
    }
  }
  dispose(): void {
    this.handoff?.dispose();
    this.traceGeometry.dispose();
    this.traceMaterial.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.quadMaterial.dispose();
    this.slotTarget?.dispose();
    this.nativeTarget?.dispose();
    this.scene.clear();
    this.quadScene.clear();
  }
}
