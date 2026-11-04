import type {
  Atom,
  CellRepeat,
  InterstitialSite,
  StructureId,
  StructureMeta,
} from '../crystal/types';

export function fmt(value: number, digits = 4): string {
  return value.toFixed(digits);
}

export function pct(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function fracText(x: number, y: number, z: number, digits = 3): string {
  return `(${x.toFixed(digits)}, ${y.toFixed(digits)}, ${z.toFixed(digits)})`;
}

export function atomKindLabel(kind: Atom['kind']): string {
  switch (kind) {
    case 'corner':
      return '角点';
    case 'face':
      return '面心';
    case 'body':
      return '体心';
    case 'A':
      return 'A 层';
    case 'B':
      return 'B 层';
    default:
      return kind;
  }
}

export function atomLayerLabel(atom: Atom, structure: StructureId): string {
  if (structure === 'hcp') return atom.kind === 'A' ? 'A 层 · 六方' : 'B 层 · 六方';
  return `壳层 ${atom.layer}`;
}

export function siteTypeLabel(type: InterstitialSite['type']): string {
  return type === 'O' ? '八面体' : '四面体';
}

export function siteShapeLabel(site: InterstitialSite, structure: StructureId): string {
  if (site.type === 'T') return '四面体';
  return structure === 'bcc' ? '扁八面体' : '八面体';
}

export function siteCoordinationLabel(site: InterstitialSite): string {
  return `CN ${site.coordination}/${site.expectedCoordination}`;
}

export function structureEnglish(id: StructureId): string {
  switch (id) {
    case 'fcc':
      return 'FACE-CENTERED CUBIC';
    case 'bcc':
      return 'BODY-CENTERED CUBIC';
    case 'hcp':
      return 'HEXAGONAL CLOSE-PACKED';
  }
}

export function structureIndex(id: StructureId): string {
  return id === 'fcc' ? '01' : id === 'bcc' ? '02' : '03';
}

export function structureExamples(id: StructureId): string {
  switch (id) {
    case 'fcc':
      return 'Cu · Al · Au · Ag';
    case 'bcc':
      return 'α-Fe · W · Mo · Cr';
    case 'hcp':
      return 'Mg · Ti · Zn · Co';
  }
}

export function cellDescriptor(id: StructureId, repeat: CellRepeat = 2): string {
  if (id === 'hcp') return '六方棱柱 · 3 原胞';
  return repeat === 1 ? '1×1×1 常规晶胞' : '2×2×2 超胞';
}

export function cellNote(id: StructureId, repeat: CellRepeat = 2): string {
  if (id === 'hcp') {
    return '线框：六方棱柱（含 3 个原胞 / 6 原子）。12 个角点与上下底面心都落在 A 层原子列上，棱柱自下层 A 面延伸到上层 A 面、高 c；中层为 B 层，虚线只标中截面（3 个内部 B 原子位于其中）。球缝中棱被球体正确遮挡。';
  }
  const frame =
    repeat === 1
      ? '1×1×1 常规晶胞外框（8 角点 + 12 条棱，无内部分面）'
      : '2×2×2 超胞外框 + 三个中分面（x=1、y=1、z=1）';
  return `线框：${frame}，全部由晶格矢量与分数坐标计算。球缝中只显示虚线与顶点角标。换用 1×1×1 只改变展示范围，晶格常数、键长、配位数与 APF 均不变。`;
}

export function theorySiteText(meta: StructureMeta): string {
  if (meta.id === 'hcp') {
    return `O ${meta.octahedralPerConventionalCell} · T ${meta.tetrahedralPerConventionalCell}`;
  }
  return `O ${meta.octahedralPerConventionalCell} · T ${meta.tetrahedralPerConventionalCell}`;
}

export function theorySiteNote(meta: StructureMeta): string {
  if (meta.id === 'hcp') {
    return `六方棱柱 / 3 原胞（原胞 O ${meta.octahedralPerPrimitiveCell} · T ${meta.tetrahedralPerPrimitiveCell}）`;
  }
  return '每惯用胞';
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g)
    .toString(16)
    .padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`.toUpperCase();
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
