import { Mesh } from 'molstar/lib/mol-geo/geometry/mesh/mesh.js';
import { MeshBuilder } from 'molstar/lib/mol-geo/geometry/mesh/mesh-builder.js';
import { addCylinder } from 'molstar/lib/mol-geo/geometry/mesh/builder/cylinder.js';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra.js';
import { Shape } from 'molstar/lib/mol-model/shape.js';
import { PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects.js';
import type { PluginContext } from 'molstar/lib/mol-plugin/context.js';
import { StateTransformer } from 'molstar/lib/mol-state';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { Task } from 'molstar/lib/mol-task';
import { Color } from 'molstar/lib/mol-util/color/color.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';

/** App-owned transformer namespace, so nothing collides with Mol*'s `ms-plugin`. */
const XtbTransform = StateTransformer.builderFactory('xtb-ir');

export interface ArrowData {
  /** Equilibrium coordinates in Angstrom, atom-major. */
  coordinates: number[];
  /** Cartesian displacement, atom-major, already scaled to Angstrom. */
  displacement: number[];
  /** Arrow colour as a packed 0xRRGGBB integer. */
  color: number;
  /** Radius of the arrow shaft in Angstrom. */
  shaftRadius: number;
  /** Arrows shorter than this (Angstrom) are skipped. */
  minLength: number;
}

/** One cone-tipped cylinder per atom, pointing along that atom's displacement. */
export function buildArrowMesh(data: ArrowData, previous?: Mesh): Mesh {
  const { coordinates, displacement, shaftRadius, minLength } = data;
  const atomCount = coordinates.length / 3;
  const state = MeshBuilder.createState(atomCount * 256, atomCount * 128, previous);
  const start = Vec3();
  const joint = Vec3();
  const end = Vec3();

  for (let i = 0; i < atomCount; i++) {
    const k = 3 * i;
    const dx = displacement[k] as number;
    const dy = displacement[k + 1] as number;
    const dz = displacement[k + 2] as number;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < minLength) continue;

    const sx = coordinates[k] as number;
    const sy = coordinates[k + 1] as number;
    const sz = coordinates[k + 2] as number;
    Vec3.set(start, sx, sy, sz);
    Vec3.set(end, sx + dx, sy + dy, sz + dz);
    // The head takes the last 35 % of the arrow.
    Vec3.set(joint, sx + dx * 0.65, sy + dy * 0.65, sz + dz * 0.65);

    state.currentGroup = i;
    addCylinder(state, start, joint, 1, {
      radiusTop: shaftRadius,
      radiusBottom: shaftRadius,
      topCap: true,
      bottomCap: true,
      radialSegments: 12,
    });
    addCylinder(state, joint, end, 1, {
      radiusTop: 0,
      radiusBottom: shaftRadius * 2.5,
      topCap: true,
      bottomCap: true,
      radialSegments: 12,
    });
  }

  // No explicit bounding sphere: Mol* derives it from the vertex buffer, so the
  // arrows never inflate the scene bounds and never pull the camera back.
  return MeshBuilder.getMesh(state);
}

const ModeArrows3D = XtbTransform({
  name: 'mode-arrows-3d',
  display: 'Normal-mode arrows',
  from: SO.Root,
  to: SO.Shape.Provider,
  params: {
    coordinates: PD.Value<number[]>([], { isHidden: true }),
    displacement: PD.Value<number[]>([], { isHidden: true }),
    color: PD.Color(Color(0xff_57_22)),
    shaftRadius: PD.Numeric(0.04, { min: 0.01, max: 0.3, step: 0.005 }),
    minLength: PD.Numeric(0.05, { min: 0, max: 1, step: 0.01 }),
  },
})({
  canAutoUpdate: () => true,
  apply({ params }) {
    return Task.create('Normal-mode arrows', async () => {
      return new SO.Shape.Provider(
        {
          label: 'Normal-mode arrows',
          data: params,
          params: Mesh.Params,
          getShape: (_, data: ArrowData, __, previous?: Shape<Mesh>) =>
            Shape.create(
              'Normal-mode arrows',
              data,
              buildArrowMesh(data, previous?.geometry),
              () => Color(data.color),
              () => 1,
              (group) => `displacement of atom ${group + 1}`,
            ),
          geometryUtils: Mesh.Utils,
        },
        { label: 'Normal-mode arrows' },
      );
    });
  },
});

/**
 * Draw (or update) the displacement arrows of one normal mode.
 * @param plugin Live plugin.
 * @param coordinates Equilibrium coordinates in Angstrom, atom-major.
 * @param displacement Cartesian displacement, atom-major, scaled to Angstrom.
 * @param options.color Packed 0xRRGGBB arrow colour.
 * @default options.color 0xff5722
 */
export async function showModeArrows(
  plugin: PluginContext,
  coordinates: ArrayLike<number>,
  displacement: ArrayLike<number>,
  options: { color?: number; shaftRadius?: number; minLength?: number } = {},
): Promise<void> {
  const params = {
    coordinates: Array.from(coordinates),
    displacement: Array.from(displacement),
    color: Color(options.color ?? 0xff_57_22),
    shaftRadius: options.shaftRadius ?? 0.05,
    minLength: options.minLength ?? 0.05,
  };
  const existing = plugin.state.data.select(ARROWS_REF)[0];
  const update = plugin.state.data.build();
  if (existing) {
    update.to(ARROWS_REF).update(params);
  } else {
    update
      .toRoot()
      .apply(ModeArrows3D, params, { ref: ARROWS_REF })
      .apply(StateTransforms.Representation.ShapeRepresentation3D);
  }
  await update.commit();
}

/** Remove the arrows if they are present. */
export async function hideModeArrows(plugin: PluginContext): Promise<void> {
  if (!plugin.state.data.select(ARROWS_REF)[0]) return;
  await plugin.state.data.build().delete(ARROWS_REF).commit();
}

const ARROWS_REF = 'xtb-mode-arrows';
