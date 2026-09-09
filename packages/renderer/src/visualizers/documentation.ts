import type { VisualizerDocumentation, VisualizerReference } from './types.js';

function ref(label: string, url: string): VisualizerReference {
  return { label, url };
}

const AUDIO_BANDS = ['bands', 'rms', 'spectral-centroid', 'beat'] as const;
const AUDIO_BANDS_AND_FLUX = [
  'bands',
  'rms',
  'spectral-centroid',
  'spectral-flux',
  'beat',
] as const;
const AUDIO_WAVEFORM = [
  'fft',
  'bands',
  'rms',
  'spectral-centroid',
  'beat',
] as const;

export const VISUALIZER_DOCUMENTATION: Record<string, VisualizerDocumentation> =
  {
    'caustics-beta': {
      summary: 'Forward deposition of refracted light onto a receiver',
      math: 'Analytic height gradients, Snell refraction, Fresnel transmission and normalized photon deposition into a linear half-float light map.',
      references: [
        {
          label: 'Model reference',
          url: 'https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'magnetic-beta': {
      summary: 'Field-line traces of physical magnetic dipoles',
      math: 'B=(3r(m·r)/r²−m)/r³; RK4 traces in a plane containing the dipole moments.',
      references: [
        {
          label: 'Model reference',
          url: 'https://farside.ph.utexas.edu/teaching/jk1/Electromagnetism/node52.html',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'soliton-beta': {
      summary: 'Exact two-soliton Hirota collision',
      math: 'u=2∂x²log(1+e^η1+e^η2+A12e^(η1+η2)), with A12=((k1−k2)/(k1+k2))².',
      references: [
        {
          label: 'Model reference',
          url: 'https://www.maths.dur.ac.uk/users/stefano.cremonesi/pictures_animations_Solitons/Solitons_notes_2023_24.pdf',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'kleinian-beta': {
      summary: 'Limit set of explicit Möbius generators',
      math: 'g(z)=target+r²/(z−source). Four disjoint defining circles; reduced words omit immediate inverse generators.',
      references: [
        {
          label: 'Model reference',
          url: 'https://www.ams.org/journals/notices/200301/200301FullIssue.pdf',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'geodesic-beta': {
      summary: 'Subdivided icosahedron with true triangle edges',
      math: 'Icosahedral subdivision projected radially onto a sphere, rendered with barycentric edges.',
      references: [
        {
          label: 'Model reference',
          url: 'https://threejs.org/docs/#api/en/geometries/IcosahedronGeometry',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'penrose-beta': {
      summary: 'Oriented Robinson-triangle substitution',
      math: 'Golden-ratio subdivision of acute and obtuse Robinson triangles; global transforms preserve shared edges.',
      references: [
        {
          label: 'Model reference',
          url: 'https://tilings.math.uni-bielefeld.de/substitution/robinson-triangle/',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'apollonian-beta': {
      summary:
        'Tangent Descartes circles with a tangency-preserving Möbius deformation',
      math: 'Curvature reflection k′=2Σk−k_old, with the same reflection for bend-centers.',
      references: [
        {
          label: 'Model reference',
          url: 'https://www.ams.org/journals/bull/2013-50-02/S0273-0979-2013-01405-8/S0273-0979-2013-01405-8.pdf',
        },
      ],
      audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },

    'reaction-beta': {
      summary:
        'Persistent Gray–Scott fields evolved on the GPU, with fixed substeps, a nine-point Laplacian and periodic boundaries.',
      math: 'u_t = ∇²u − uv² + F(1−u); v_t = 0.5∇²v + uv² − (F+k)v. Explicit steps Δt=0.25; nonnegative concentrations.',
      references: [
        ref(
          'Karl Sims: reaction-diffusion',
          'https://www.karlsims.com/rd.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    'automata-beta': {
      summary:
        'A persistent Conway Life grid; each generation reads the previous complete generation.',
      math: 'B3/S23: an empty cell is born with three live neighbors; a live cell survives with two or three. Periodic boundaries.',
      references: [
        ref('Golly cellular automata', 'https://golly.sourceforge.io/'),
      ],
      audioInputsUsed: ['rms', 'spectral-centroid', 'beat'],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    orbital: {
      summary:
        'CPU particle simulation with orbiting emitters, central gravity, and curl-like turbulence.',
      math: 'No single closed-form reference; the system combines emitter orbits, inverse-square pull, damping, and procedural turbulence.',
      references: [
        ref(
          'Inverse Square Law',
          'https://scienceworld.wolfram.com/physics/InverseSquareLaw.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS, 'spectral-flux'],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    'orbital-beta': {
      summary:
        'Chaotic 3D particle simulation with tilted emitters and fully 3D tangential launch vectors.',
      math: 'No single closed-form reference; this variant extends the orbital particle system with 3D emitter frames and drift perturbations.',
      references: [
        ref(
          'Inverse Square Law',
          'https://scienceworld.wolfram.com/physics/InverseSquareLaw.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS, 'spectral-flux'],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    'orbital-gamma': {
      summary:
        'Interactive particle sculpting system with user-placed attractors and repulsors.',
      math: 'No single closed-form reference; this variant builds on the orbital particle system and adds temporary inverse-square force fields.',
      references: [
        ref(
          'Inverse Square Law',
          'https://scienceworld.wolfram.com/physics/InverseSquareLaw.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS, 'spectral-flux'],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    waveform: {
      summary:
        'Layered FFT-driven waveform renderer with procedural idle motion and spectral color mapping.',
      math: 'Combines sampled FFT magnitudes with synthetic line layers and glow falloff.',
      references: [
        ref(
          'Fourier Transform',
          'https://mathworld.wolfram.com/FourierTransform.html',
        ),
        ref(
          'Nyquist Frequency',
          'https://mathworld.wolfram.com/NyquistFrequency.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_WAVEFORM],
      requiresFFT: true,
      perfTier: 'medium',
      mobileSafe: true,
    },
    mandelbrot: {
      summary:
        'Quadratic escape-time fractal with smooth iteration coloring and zoom cycling.',
      math: 'z_(n+1) = z_n^2 + c, with c sampled from the complex plane and z_0 = 0.',
      references: [
        ref(
          'Mandelbrot Set',
          'https://mathworld.wolfram.com/MandelbrotSet.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    burningship: {
      summary:
        'Absolute-value escape-time fractal derived from the Mandelbrot recurrence.',
      math: 'z_(n+1) = (|Re(z_n)| + i|Im(z_n)|)^2 + c, with z_0 = 0.',
      references: [
        ref(
          'Burning Ship Fractal',
          'https://www.paulbourke.net/fractals/burnship/',
        ),
        ref(
          'Burning Ship Fractal (overview)',
          'https://en.wikipedia.org/wiki/Burning_Ship_fractal',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    julia: {
      summary:
        'Quadratic Julia-set renderer that animates the complex seed parameter c.',
      math: 'z_(n+1) = z_n^2 + c for a fixed complex seed c; the set is the boundary of points that remain bounded.',
      references: [
        ref('Julia Set', 'https://mathworld.wolfram.com/JuliaSet.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    newton: {
      summary: 'Newton-Raphson basin renderer for polynomial root finding.',
      math: "z_(n+1) = z_n - f(z_n) / f'(z_n), colored by converged root and convergence speed.",
      references: [
        ref(
          'Newton-Raphson Fractal',
          'https://mathworld.wolfram.com/Newton-RaphsonFractal.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    lyapunov: {
      summary:
        'Lyapunov-exponent field visualizing chaotic and stable regions of parameter space.',
      math: 'Evaluates the Lyapunov exponent over an iterated logistic-map parameter sequence.',
      references: [
        ref(
          'Lyapunov Exponent',
          'https://mathworld.wolfram.com/LyapunovExponent.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: false,
    },
    apollonian: {
      summary: 'Circle-inversion pattern inspired by Apollonian gaskets.',
      math: 'Iterates inversions in a tangent-circle arrangement; does not construct a Descartes packing.',
      references: [
        ref(
          'Apollonian Gasket',
          'https://mathworld.wolfram.com/ApollonianGasket.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    quatjulia: {
      summary:
        'Quaternion Julia fractal rendered as a 3D distance-estimated form.',
      math: 'Extends the Julia recurrence to quaternions and raymarches the resulting 3D set.',
      references: [
        ref(
          'Quaternion Julia Sets',
          'https://en.wikipedia.org/wiki/Quaternion_Julia_set',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
    voronoi: {
      summary:
        'Distance-field Voronoi renderer with animated seeds and metric blending.',
      math: 'Partitions the plane by nearest seed point using F1/F2 cell distances, with Euclidean-Manhattan interpolation.',
      references: [
        ref(
          'Voronoi Diagram',
          'https://mathworld.wolfram.com/VoronoiDiagram.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    'voronoi-beta': {
      summary:
        '3D Voronoi foam: Voro++ tessellates drifting seeds into convex polyhedral cells.',
      math: 'Each seed owns the convex polyhedron of points closer to it than to any other seed. Voro++ constructs that cell by successive plane cuts (perpendicular bisectors to neighbors) of the bounding container.',
      references: [
        ref('Voro++', 'https://math.lbl.gov/voro++/'),
        ref(
          'Voronoi Diagram',
          'https://mathworld.wolfram.com/VoronoiDiagram.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    'voronoi-gamma': {
      summary:
        'Periodic 3D Voronoi crystal: cells wrap through opposite faces instead of flattening on the box walls.',
      math: 'The Voro++ container is periodic in x, y, and z. Neighbor searches wrap through the opposite face, so a boundary cell meets the periodic image of a seed on the far side rather than being truncated by a wall plane.',
      references: [
        ref('Voro++', 'https://math.lbl.gov/voro++/'),
        ref(
          'Periodic Boundary Conditions',
          'https://en.wikipedia.org/wiki/Periodic_boundary_conditions',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    'voronoi-delta': {
      summary:
        'Radical (Laguerre) foam: larger seeds consume volume from their neighbors.',
      math: 'The radical / power diagram weights each site by a radius r. The cell boundary between i and j is the plane d(x,i)² − r_i² = d(x,j)² − r_j², so a larger seed eats into its neighbors. Voro++ implements this via container_poly.',
      references: [
        ref('Voro++', 'https://math.lbl.gov/voro++/'),
        ref('Power Diagram', 'https://en.wikipedia.org/wiki/Power_diagram'),
        ref(
          'Laguerre Diagram',
          'https://mathworld.wolfram.com/LaguerreVoronoiDiagram.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    'voronoi-epsilon': {
      summary:
        'Spherical-wall foam globe: Voro++ clips every cell to the interior of a ball.',
      math: 'A wall_sphere clips cells to r < r_c by cutting each cell with the tangent plane at the nearest point on the sphere. Seeds sit on a Fibonacci spherical shell plus a small core, so the silhouette is a globe rather than a cube.',
      references: [
        ref('Voro++', 'https://math.lbl.gov/voro++/'),
        ref(
          'Spherical Voronoi Diagram',
          'https://en.wikipedia.org/wiki/Voronoi_diagram#On_a_sphere',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    lissajous: {
      summary:
        'Damped harmonograph / Lissajous hybrid rendered as luminous curve trails.',
      math: 'Pure Lissajous figures follow x = A cos(ω_x t - δ_x), y = B cos(ω_y t - δ_y); this visualizer adds harmonograph-style damping and extra harmonics.',
      references: [
        ref(
          'Lissajous Curve',
          'https://mathworld.wolfram.com/LissajousCurve.html',
        ),
        ref('Harmonograph', 'https://mathworld.wolfram.com/Harmonograph.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    kaleidoscope: {
      summary:
        'Radial fold-and-mirror pattern generator based on dihedral symmetry.',
      math: 'Maps points into a reflected angular wedge of size 2π / n, corresponding to dihedral-group symmetry.',
      references: [
        ref(
          'Dihedral Group',
          'https://mathworld.wolfram.com/DihedralGroup.html',
        ),
        ref(
          'Symmetry Group',
          'https://mathworld.wolfram.com/SymmetryGroup.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    hyperbolic: {
      summary: 'Hyperbolic tiling visualizer in a Poincare-disk-style model.',
      math: 'Uses hyperbolic geometry in the disk model to tile beyond Euclidean angle limits.',
      references: [
        ref(
          'Poincare Hyperbolic Disk',
          'https://mathworld.wolfram.com/PoincareHyperbolicDisk.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    chladni: {
      summary: 'Rectangular Chladni plate node pattern renderer.',
      math: 'Uses modal nodal-line patterns from vibrating plates, typically from sin/cos mode combinations.',
      references: [
        ref('Chladni Figure', 'https://en.wikipedia.org/wiki/Chladni_figure'),
      ],
      audioInputsUsed: [...AUDIO_BANDS, 'spectral-flux'],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    'chladni-circular': {
      summary: 'Circular-membrane cymatic pattern renderer.',
      math: 'Uses circular membrane vibration modes J_n(j_nm r/R) with fixed-edge boundary conditions; FFT-band weights are artistic, not calibrated resonances.',
      references: [
        ref(
          'Bessel Function',
          'https://mathworld.wolfram.com/BesselFunctionoftheFirstKind.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_WAVEFORM],
      requiresFFT: true,
      perfTier: 'medium',
      mobileSafe: true,
    },
    phyllotaxis: {
      summary:
        'Golden-angle spiral growth visualizer inspired by sunflower packing.',
      math: 'Typically places point n at radius proportional to sqrt(n) and angle n times the golden angle.',
      references: [
        ref('Phyllotaxis', 'https://mathworld.wolfram.com/Phyllotaxis.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    superformula: {
      summary: 'Radial shape visualizer based on the Gielis superformula.',
      math: 'Generalizes superellipses with a polar radius formula controlled by m, n1, n2, and n3.',
      references: [
        ref('Superformula', 'https://mathworld.wolfram.com/Superformula.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    quasicrystal: {
      summary:
        'Aperiodic interference visualizer inspired by quasicrystal symmetry.',
      math: 'Builds aperiodic order from interference sums with forbidden crystallographic symmetries such as 5-fold order.',
      references: [
        ref(
          'Crystallography Restriction',
          'https://mathworld.wolfram.com/CrystallographyRestriction.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    domainwarp: {
      summary:
        'Noise-field visualizer that warps coordinates before resampling a base field.',
      math: 'Domain warping composes p with a secondary noise offset field before evaluating the main function.',
      references: [
        ref('Fractal Brownian Motion', 'https://thebookofshaders.com/13/'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    'domainwarp-recursive': {
      summary:
        'Recursive domain-warp visualizer with repeated coordinate remapping.',
      math: 'Applies multiple nested warp stages to increase deformation complexity.',
      references: [
        ref('Fractal Brownian Motion', 'https://thebookofshaders.com/13/'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    truchet: {
      summary:
        'Tile-based pattern visualizer using Truchet-style local motifs.',
      math: 'Uses a repeated square tiling with per-cell motif selection and symmetry transforms.',
      references: [
        ref('Truchet Tiling', 'https://en.wikipedia.org/wiki/Truchet_tiles'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    clifford: {
      summary:
        'Clifford attractor renderer for planar strange-attractor point sets.',
      math: 'Iterates the standard Clifford attractor recurrence on x and y.',
      references: [
        ref(
          'Clifford Attractor',
          'https://en.wikipedia.org/wiki/Clifford_attractor',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    harmonograph: {
      summary:
        'Damped pendulum-trace visualizer in the style of mechanical harmonographs.',
      math: 'Models orthogonal damped sinusoids whose traces contract as energy decays.',
      references: [
        ref('Harmonograph', 'https://mathworld.wolfram.com/Harmonograph.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    moire: {
      summary: 'Interference renderer from overlapping line or grid fields.',
      math: 'Produces moire patterns by superposing nearly aligned periodic structures.',
      references: [
        ref(
          'Moire Pattern',
          'https://en.wikipedia.org/wiki/Moir%C3%A9_pattern',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    plasma: {
      summary:
        'Classic demoscene plasma shader from summed smooth waves and palette mapping.',
      math: 'Combines low-frequency sinusoidal fields and color palettes to produce a continuous plasma field.',
      references: [
        ref('Plasma Effect', 'https://en.wikipedia.org/wiki/Plasma_effect'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    flowfield: {
      summary: 'Vector-field streamline visualizer.',
      math: 'Samples a procedurally defined 2D vector field and advects streamlines or particles through it.',
      references: [
        ref('Vector Field', 'https://mathworld.wolfram.com/VectorField.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    spirograph: {
      summary: 'Epitrochoid / hypotrochoid curve visualizer.',
      math: 'Uses rolling-circle parametric curves such as epitrochoids and hypotrochoids.',
      references: [
        ref('Spirograph', 'https://mathworld.wolfram.com/Spirograph.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    automata: {
      summary: 'Procedural cellular-pattern visualizer.',
      math: 'Applies neighborhood growth to fresh procedural noise each frame; no persistent cellular state is evolved.',
      references: [
        ref(
          'Cellular Automaton',
          'https://mathworld.wolfram.com/CellularAutomaton.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    reaction: {
      summary: 'Noise-based reaction-diffusion-inspired pattern visualizer.',
      math: 'Layers noise to resemble spots and stripes; does not integrate the Gray–Scott or Turing equations.',
      references: [
        ref(
          'Reaction-Diffusion',
          'https://mathworld.wolfram.com/Reaction-DiffusionEquation.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    rosecurve: {
      summary: 'Polar rhodonea-curve renderer.',
      math: 'Uses polar curves of the form r = a cos(kθ) or r = a sin(kθ).',
      references: [
        ref('Rose Curve', 'https://mathworld.wolfram.com/RoseCurve.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'low',
      mobileSafe: true,
    },
    penrose: {
      summary: 'Penrose-inspired five-direction multigrid.',
      math: 'Draws five families of grid lines; does not construct the dual Penrose rhombs or enforce matching rules.',
      references: [
        ref('Penrose Tiles', 'https://mathworld.wolfram.com/PenroseTiles.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    soliton: {
      summary: 'Wave visualizer inspired by soliton interactions.',
      math: 'Superposes periodically wrapped sech² pulses with the single-KdV amplitude/width/speed relation; nonlinear collision phase shifts are not modeled.',
      references: [
        ref('Soliton', 'https://mathworld.wolfram.com/Soliton.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    terrain: {
      summary: 'Raymarched procedural terrain.',
      math: 'Raymarches a layered-noise height field using vertical clearance as a stepping heuristic, not an exact signed distance.',
      references: [
        ref(
          'Terrain Modeling',
          'https://en.wikipedia.org/wiki/Terrain_rendering',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
    geodesic: {
      summary: 'Raymarched faceted-sphere approximation.',
      math: 'Uses latitude/longitude quantization and noise on a sphere; no icosahedral or Goldberg subdivision is constructed.',
      references: [
        ref('Geodesic Dome', 'https://mathworld.wolfram.com/GeodesicDome.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    tunnel: {
      summary: 'Infinite tunnel renderer.',
      math: 'Uses repeated radial distance fields and raymarching along a longitudinal axis.',
      references: [
        ref(
          'Distance Function Basics',
          'https://iquilezles.org/articles/distfunctions/',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    interference: {
      summary: 'Wave-interference field visualizer.',
      math: 'Superposes multiple oscillatory sources to produce constructive and destructive interference.',
      references: [
        ref(
          'Wave Interference',
          'https://mathworld.wolfram.com/WaveInterference.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    metaballs: {
      summary: 'Implicit-surface metaball renderer.',
      math: 'Uses scalar field summation around moving centers with an isosurface threshold.',
      references: [ref('Metaball', 'https://en.wikipedia.org/wiki/Metaballs')],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    mandelbulb: {
      summary: '3D power-form Mandelbulb fractal raymarcher.',
      math: 'Extends Mandelbrot-style power iteration to spherical 3D coordinates and distance estimation.',
      references: [
        ref('Mandelbulb', 'https://en.wikipedia.org/wiki/Mandelbulb'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
    attractor: {
      summary: 'Classic strange-attractor particle renderer.',
      math: 'Integrates a low-dimensional chaotic attractor in continuous or discrete time.',
      references: [
        ref(
          'Strange Attractor',
          'https://mathworld.wolfram.com/StrangeAttractor.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    hopalong: {
      summary: 'Hopalong attractor point renderer.',
      math: 'Uses the Martin / Hopalong attractor recurrence to generate dense planar point sets.',
      references: [
        ref(
          'Hopalong Attractor',
          'https://en.wikipedia.org/wiki/Hopalong_attractor',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    dejong: {
      summary: 'Peter de Jong attractor renderer.',
      math: 'Uses the standard de Jong map with sinusoidal coordinate recurrences.',
      references: [
        ref(
          'De Jong Attractor',
          'https://en.wikipedia.org/wiki/Attractor#Peter_de_Jong_map',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    ikeda: {
      summary: 'Ikeda-map attractor renderer.',
      math: 'Uses the Ikeda map recurrence derived from an optical resonator model.',
      references: [ref('Ikeda Map', 'https://en.wikipedia.org/wiki/Ikeda_map')],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    aizawa: {
      summary: 'Aizawa attractor renderer.',
      math: 'Uses the six-parameter Aizawa continuous-time chaotic system.',
      references: [
        ref(
          'Aizawa Attractor',
          'https://en.wikipedia.org/wiki/Aizawa_attractor',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    lorenz: {
      summary: 'Classic Lorenz 1963 butterfly rendered as orbiting 3D trails.',
      math: 'dx/dt = σ(y − x), dy/dt = x(ρ − z) − y, dz/dt = xy − βz, with σ=10, ρ=28, β=8/3.',
      references: [
        ref(
          'Lorenz Attractor',
          'https://mathworld.wolfram.com/LorenzAttractor.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    'lorenz-beta': {
      summary:
        'Rössler single-scroll attractor rendered as orbiting 3D trails.',
      math: 'dx/dt = −y − z, dy/dt = x + a y, dz/dt = b + z(x − c), with a=0.2, b=0.2, c=5.7.',
      references: [
        ref(
          'Rössler Attractor',
          'https://mathworld.wolfram.com/RoesslerAttractor.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    'lorenz-gamma': {
      summary: 'Chen dual-wing attractor rendered as orbiting 3D trails.',
      math: 'dx/dt = a(y − x), dy/dt = (c − a)x − xz + c y, dz/dt = xy − b z, with a=35, b=3, c=28.',
      references: [
        ref(
          'Chen System',
          'https://en.wikipedia.org/wiki/Multiscroll_attractor',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    magnetic: {
      summary:
        'Field-line visualizer for dipole / multipole magnetic patterns.',
      math: 'Uses softened planar source/sink fields q*r/(r²+epsilon); this is a dipole analogy, not a three-dimensional magnetic-field solution.',
      references: [
        ref(
          'Magnetic Dipole',
          'https://mathworld.wolfram.com/MagneticDipole.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    gyroid: {
      summary: 'Gyroid nodal-surface approximation.',
      math: 'Uses sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0, a nodal approximation to the minimal gyroid, with a conservative gradient bound for marching.',
      references: [ref('Gyroid', 'https://mathworld.wolfram.com/Gyroid.html')],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
    hopf: {
      summary: 'Hopf-fibration-inspired fiber bundle renderer.',
      math: 'Maps S^3 fibers to circles over points on S^2 in the Hopf fibration.',
      references: [
        ref('Hopf Fibration', 'https://mathworld.wolfram.com/HopfMap.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
    kleinian: {
      summary: 'Circle-inversion pattern inspired by Indra’s Pearls.',
      math: 'Uses conditional circle inversions, folds, and translations; these do not establish a discrete Kleinian group or its limit set.',
      references: [
        ref(
          'Kleinian Group',
          'https://mathworld.wolfram.com/KleinianGroup.html',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    caustics: {
      summary: 'Refraction / caustic-pattern visualizer.',
      math: 'Approximates concentrated light patterns caused by refracting or reflecting surfaces.',
      references: [
        ref('Caustic', 'https://en.wikipedia.org/wiki/Caustic_(optics)'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    ferrofluid: {
      summary: 'Procedural ferrofluid-inspired surface.',
      math: 'Uses a procedural radial spike surface inspired by ferrofluids; no magnetic free-surface stability equations are solved.',
      references: [
        ref(
          'Rosensweig Instability',
          'https://en.wikipedia.org/wiki/Rosensweig_instability',
        ),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
    orbittrap: {
      summary: 'Orbit-trap fractal coloring visualizer.',
      math: 'Colors escape-time fractals by measuring distance to a chosen geometric trap during iteration.',
      references: [
        ref('Orbit Trap', 'https://en.wikipedia.org/wiki/Orbit_trap'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    aurora: {
      summary: 'Aurora curtain renderer.',
      math: 'Uses layered noise and vertical falloff to approximate curtain-like auroral motion rather than a strict physical plasma model.',
      references: [ref('Aurora', 'https://en.wikipedia.org/wiki/Aurora')],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'high',
      mobileSafe: false,
    },
    dendrite: {
      summary: 'Dendritic crystal-growth visualizer.',
      math: 'Approximates branching growth processes associated with diffusion-limited or anisotropic crystal formation.',
      references: [
        ref('Dendrite', 'https://en.wikipedia.org/wiki/Dendrite_(crystal)'),
      ],
      audioInputsUsed: [...AUDIO_BANDS_AND_FLUX],
      requiresFFT: false,
      perfTier: 'medium',
      mobileSafe: true,
    },
    torusknot: {
      summary: 'Raymarched torus-knot visualizer.',
      math: 'Uses parameterized torus knots classified by integer winding numbers p and q.',
      references: [
        ref('Torus Knot', 'https://mathworld.wolfram.com/TorusKnot.html'),
      ],
      audioInputsUsed: [...AUDIO_BANDS],
      requiresFFT: false,
      perfTier: 'extreme',
      mobileSafe: false,
    },
  };

// Reviewed descriptions refer to the representation actually rendered, including its approximations.
const reviewed: Record<string, Partial<VisualizerDocumentation>> = {
  terrain: {
    summary:
      'Explicit height mesh with detail tied to the quality budget, integrated flow and height-based lighting. A finite patch samples the procedural landscape; surface visibility does not depend on raymarch convergence.',
    math: 'Vertex height combines smooth and ridged fractal noise plus bounded audio ripples. Normals use central height differences.',
    perfTier: 'medium',
  },
  waveform: {
    summary:
      'Triggered DC-removed oscilloscope, calibrated logarithmic-frequency spectrum, or artistic layered waves.',
    audioInputsUsed: [
      'waveform',
      'fft',
      'bands',
      'rms',
      'spectral-centroid',
      'beat',
    ],
    requiresFFT: true,
    perfTier: 'low',
  },
  julia: {
    summary:
      'Quadratic Julia sets with a connected main-cardioid path, period-two bulb path, disconnected dust path, and artistic seed morphing.',
  },
  lyapunov: {
    summary:
      'Logistic-map Lyapunov estimates for AB/AAB/ABB/ABBA or event-seeded sequences, with a half/full-window convergence diagnostic.',
  },
  chladni: {
    summary:
      'Fixed-edge square membrane modes with integer indices and frequency-selective excitation. This is a membrane model, not a free plate.',
    math: 'u(x,y)=sin(nπ(x+1/2))sin(mπ(y+1/2))−sin(mπ(x+1/2))sin(nπ(y+1/2)); n=m uses one nonzero mode. f_nm∝sqrt(n²+m²).',
    audioInputsUsed: ['fft', 'bands', 'rms', 'beat'],
    requiresFFT: true,
  },
  'chladni-circular': {
    summary:
      'Fixed-rim circular membrane eigenmodes with Bessel roots, frequency-selective resonances and damped amplitudes.',
    math: 'J_n(j_nm r/R)cos(nθ+φ); f_nm/f_01=j_nm/j_01. Q specifies resonance bandwidth.',
    audioInputsUsed: ['fft', 'bands', 'rms', 'spectral-centroid', 'beat'],
    requiresFFT: true,
  },
  lissajous: {
    summary:
      'Sampled rational Lissajous curves, with confident pitch-to-ratio and dominant-bin stereo-phase controls.',
    audioInputsUsed: [
      'pitch',
      'stereo',
      'bands',
      'rms',
      'spectral-centroid',
      'beat',
    ],
    perfTier: 'low',
  },
  harmonograph: {
    summary:
      'Finite-age damped pendulum traces with rational frequency ratios and onset re-excitation, rendered as line geometry.',
    perfTier: 'low',
  },
  spirograph: {
    summary:
      'Closed epitrochoid or hypotrochoid geometry, with rational rolling radii and exact closure periods.',
    math: 'Outside: (R+r)e^(it)−d e^(i(R+r)t/r). Inside: (R−r)e^(it)+d e^(−i(R−r)t/r). Period 2πr/gcd(R,r) for integer radii.',
    perfTier: 'low',
  },
  rosecurve: {
    summary:
      'Signed rational rhodonea curves, adaptively sampled with topology hysteresis.',
    math: 'r=A cos(nθ/d). Reduced odd n,d have period πd; otherwise 2πd.',
    perfTier: 'low',
  },
  superformula: {
    summary:
      'Adaptively sampled closed Gielis curves. Even m permits independent n2/n3; odd m enforces equal exponents.',
    perfTier: 'low',
  },
  phyllotaxis: {
    summary:
      'Every point is rendered as a GPU sprite. The fidelity preset preserves the golden angle; the mid-frequency ripple is radial, not depth.',
    perfTier: 'low',
  },
  clifford: {
    summary:
      'A per-pixel orbit-trap portrait of a Clifford map. For occupancy density, use Strange Attractor.',
    math: 'The map is Clifford; the displayed field mixes orbit proximity and a circular trap rather than an invariant density.',
  },
  flowfield: {
    summary:
      'Persistent tracers in a cached, prescribed incompressible Fourier flow. Color encodes analytic vorticity.',
    math: 'v=(∂yψ,−∂xψ); curl(v)=−∇²ψ. This is an advected tracer system, not a Navier–Stokes fluid solver.',
    perfTier: 'medium',
    audioInputsUsed: ['bands', 'rms', 'spectral-centroid'],
  },
  attractor: {
    summary:
      'Cached Clifford-map trajectories accumulated into a time-normalized occupancy density, with fixed seeds and transient burn-in.',
    perfTier: 'low',
  },
  hopalong: {
    summary:
      'Cached Hopalong trajectories with reproducible seeds, 512 transient iterations and persistent occupancy density.',
    perfTier: 'low',
  },
  dejong: {
    summary:
      'De Jong occupancy density with slow bounded coefficient excursions and adjustable decay time.',
    perfTier: 'low',
  },
  ikeda: {
    summary:
      'Dissipative Ikeda trajectories with burn-in and cached density. The default u=0.89 stays in a tested chaotic basin; other parameters may settle into periodic states.',
    perfTier: 'low',
  },
  aizawa: {
    summary:
      'The Aizawa ODE integrated by fixed-step RK4, rendered as batched 3D trails. The exposed parameter box is checked from the seeded basin.',
    perfTier: 'low',
  },
  lorenz: {
    summary:
      'Fixed-step RK4 Lorenz trajectories with bounded coefficient modulation and batched ribbon trails.',
    perfTier: 'low',
  },
  'lorenz-beta': {
    summary:
      'Fixed-step RK4 Rössler trajectories with a curated driven c range and batched ribbon trails.',
    perfTier: 'low',
  },
  'lorenz-gamma': {
    summary:
      'Fixed-step RK4 Chen trajectories with bounded drive and batched ribbon trails.',
    perfTier: 'low',
  },
  torusknot: {
    summary:
      'Tube geometry for every component of T(p,q). There are gcd(p,q) components, with distinct meridional phases.',
    math: 'θ=(p/d)t, φ=(q/d)t+2πj/p, d=gcd(p,q), j=0…d−1. Tube positions, thickness and color are evaluated by the vertex shader.',
    perfTier: 'low',
    mobileSafe: true,
  },
  hopf: {
    summary:
      'One batch of GPU ribbons generated from unit-S³ Hopf fibers and an isometric 4D rotation, with stereographic infinity clipped.',
    math: 'Projection xyz/(1−w). Segments near the projection pole are omitted instead of biasing the denominator.',
    perfTier: 'low',
    mobileSafe: true,
  },
  'voronoi-beta': {
    summary:
      'Worker-tessellated Euclidean cells with reused buffers and short interpolation only when connectivity is unchanged. Additive faces give an x-ray appearance.',
  },
  'voronoi-gamma': {
    summary:
      'Periodic Voro++ cells with a marked fundamental box and optional six face-neighbor images.',
  },
  'voronoi-delta': {
    summary:
      'Laguerre cells with stable input seed IDs, including hidden cells. The power metric is |x−p|²−r²; radius is not itself the power weight.',
  },
  'voronoi-epsilon': {
    summary:
      'Choose inexpensive tangent-plane wall cells or an analytically clipped ball with a rendered spherical boundary. Curved mode disables explosion; its boundary mesh is sampled.',
  },
  magnetic: {
    summary:
      'Artistic alternating point-pole field, kept separate from the physical Dipole Field Lines variant.',
  },
  interference: {
    summary:
      'Stationary nondispersive wave mode ties temporal frequency to wavenumber and adds stereo source phase; spreading uses a 2D far-field approximation.',
    audioInputsUsed: ['stereo', 'bands', 'rms', 'spectral-centroid', 'beat'],
  },
  caustics: {
    summary:
      'Fast artistic focusing proxy based on refracted height gradients; Refracted Caustics provides forward light deposition.',
  },
  ferrofluid: {
    summary:
      'Artistic spiked surface with an air/dielectric-film/substrate optical stack. Film reflection includes Snell angles, signed Fresnel amplitudes and interference phase; it does not solve a magnetic free surface.',
  },
  aurora: {
    summary:
      'Coherently advected luminous curtains with altitude-inspired green/red emission colors and one field evaluation shared by sky/reflection.',
  },
  dendrite: {
    summary:
      'Procedural branching with finite-age growth and explicit fade/reset cycles. It does not simulate diffusion-limited aggregation.',
  },
  automata: {
    summary:
      'Stateless cellular interference artwork. Conway Life provides persistent cellular-automaton evolution.',
  },
  reaction: {
    summary:
      'Stateless reaction-inspired texture. Gray–Scott provides persistent two-reagent reaction-diffusion evolution.',
  },
  apollonian: {
    summary:
      'Artistic iterated circle inversions. Descartes Packing supplies a true tangency-preserving circle packing.',
  },
  penrose: {
    summary:
      'Artistic pentagrid interference. Penrose Inflation supplies the matching-edge Robinson-triangle substitution.',
  },
  geodesic: {
    summary:
      'Artistic spherical cell pattern. Icosahedral Sphere supplies a subdivided icosahedron with actual edges.',
  },
  kleinian: {
    summary:
      'Artistic inversion parameters. Classical Schottky supplies explicit generators with disjoint defining circles.',
  },
  soliton: {
    summary:
      'Superposed isolated KdV-shaped pulses. KdV Collision supplies an exact interacting two-soliton solution.',
  },
};
for (const [type, patch] of Object.entries(reviewed))
  Object.assign(VISUALIZER_DOCUMENTATION[type], patch);
const simulations = new Set([
  'orbital',
  'orbital-beta',
  'orbital-gamma',
  'reaction-beta',
  'automata-beta',
  'flowfield',
  'aizawa',
  'lorenz',
  'lorenz-beta',
  'lorenz-gamma',
  'caustics-beta',
]);
const artistic = new Set([
  'apollonian',
  'clifford',
  'kleinian',
  'geodesic',
  'penrose',
  'soliton',
  'automata',
  'reaction',
  'caustics',
  'ferrofluid',
  'aurora',
  'dendrite',
  'domainwarp',
  'domainwarp-recursive',
  'plasma',
  'kaleidoscope',
  'magnetic',
  'terrain',
  'tunnel',
]);
for (const [type, documentation] of Object.entries(VISUALIZER_DOCUMENTATION))
  documentation.modelClass = simulations.has(type)
    ? 'simulation'
    : artistic.has(type)
      ? 'artistic'
      : 'mathematical';

export function getVisualizerDocumentation(
  type: string,
): VisualizerDocumentation | undefined {
  return VISUALIZER_DOCUMENTATION[type];
}

export function listVisualizerDocumentation(): Array<{
  type: string;
  documentation: VisualizerDocumentation;
}> {
  return Object.entries(VISUALIZER_DOCUMENTATION).map(
    ([type, documentation]) => ({ type, documentation }),
  );
}
