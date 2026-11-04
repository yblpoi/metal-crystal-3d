import type { StructureId } from '../crystal/types';

/**
 * 2D 晶胞示意图（纯静态 SVG，所有坐标手算，无运行时布局）。
 *
 * 投影：FCC/BCC 用斜投影（cavalier）——正面是边长 92 的正方形，
 * 范围 x 76…168、y 34…126；背面 = 正面沿 (+30,-22) 平移（x 106…198、
 * y 12…104），前后对应顶点相连，共 12 条棱。8 个角原子即 8 个顶点；
 * 6 个面心原子 = 各面 4 个顶点坐标的算术平均，例如正面心 (122,80)、
 * 顶面心 (137,23)、右面心 (183,69)、底面心 (137,115)、左面心 (91,69)、
 * 背面心 (152,58)；BCC 体心 = 8 个顶点平均 (137,69)。
 * 半径：角原子 4.8（前）/ 4.6（后），FCC 面心 5.5，BCC 体心 11。
 *
 * 文字：所有图形元素都不超过 y=131.4；两行文字基线固定为 y=152
 *（.cd-label）与 y=166（.cd-sub），行距 14。按移动端 11px 字号估算，
 * 末行下缘约 168.8，距 viewBox 底边仍有约 7，不会被裁切。
 *
 * HCP：左为菱形原胞——底面菱形 B1(12,128)、B2(80,128)、B3(114,69.11)、
 * B4(46,69.11)，晶轴 a1=(68,0)、a2=(34,-58.89)（|a1|=|a2|=68、夹角 60°，
 * 即 120° 原胞的镜像斜投影）、c=(0,-55.5)（c 轴按 0.5 压缩以适配面板），
 * 顶面顶点 = 底面顶点 + c；8 个角原子 + 体心 B 原子 (1/3,2/3,1/2) → (57.3,61)。
 * 右为六方棱柱——底面六边形中心 (203,103)、横向半径 33、底面竖向半高 14.3
 *（基面按 0.5 压扁）、柱高 54（=1.633×33，c/a 严格）；12 个角原子 +
 * 顶/底面心 (203,49)/(203,103) + 3 个中层 B 原子 (203,66.5)/(186.5,80.8)/
 * (219.5,80.8)，三者位于中截面且到轴距离 = a/√3。
 * 左右两列文字块共用基线 152 / 166，x 分别从 12、136 起排，互不重叠。
 *
 * 三个结构统一使用 viewBox "0 0 268 176"（宽度一致，面板内 100% 自适应）。
 */

const FCC = `
<svg viewBox="0 0 268 176" role="img" aria-label="FCC 惯用晶胞示意图">
  <g class="cd-line">
    <path d="M76 34h92v92H76Z"/>
    <path d="M106 12h92M198 12v92"/>
    <path d="M76 34 106 12M168 34 198 12M168 126 198 104"/>
    <path d="M106 12v92M106 104h92M76 126 106 104" opacity=".45"/>
  </g>
  <g class="cd-face">
    <circle cx="122" cy="80" r="5.5"/><circle cx="137" cy="23" r="5.5"/><circle cx="183" cy="69" r="5.5"/>
    <g opacity=".45">
      <circle cx="152" cy="58" r="5.5"/><circle cx="137" cy="115" r="5.5"/><circle cx="91" cy="69" r="5.5"/>
    </g>
  </g>
  <g class="cd-corner">
    <circle cx="76" cy="34" r="4.8"/><circle cx="168" cy="34" r="4.8"/><circle cx="168" cy="126" r="4.8"/><circle cx="76" cy="126" r="4.8"/>
    <circle cx="106" cy="12" r="4.6"/><circle cx="198" cy="12" r="4.6"/><circle cx="198" cy="104" r="4.6"/><circle cx="106" cy="104" r="4.6"/>
  </g>
  <text class="cd-label" x="76" y="152">惯用胞 4 原子</text>
  <text class="cd-sub" x="76" y="166">8×1/8 + 6×1/2</text>
</svg>`;

const BCC = `
<svg viewBox="0 0 268 176" role="img" aria-label="BCC 惯用晶胞示意图">
  <g class="cd-line">
    <path d="M76 34h92v92H76Z"/>
    <path d="M106 12h92M198 12v92"/>
    <path d="M76 34 106 12M168 34 198 12M168 126 198 104"/>
    <path d="M106 12v92M106 104h92M76 126 106 104" opacity=".45"/>
  </g>
  <g class="cd-corner">
    <circle cx="76" cy="34" r="4.8"/><circle cx="168" cy="34" r="4.8"/><circle cx="168" cy="126" r="4.8"/><circle cx="76" cy="126" r="4.8"/>
    <circle cx="106" cy="12" r="4.6"/><circle cx="198" cy="12" r="4.6"/><circle cx="198" cy="104" r="4.6"/><circle cx="106" cy="104" r="4.6"/>
  </g>
  <circle class="cd-body" cx="137" cy="69" r="11"/>
  <text class="cd-label" x="76" y="152">惯用胞 2 原子</text>
  <text class="cd-sub" x="76" y="166">8×1/8 + 1 体心</text>
</svg>`;

const HCP = `<svg viewBox="0 0 268 176" role="img" aria-label="HCP 原胞与六方棱柱示意图">
  <g class="cd-line">
    <path d="M12 128H80L114 69.11 46 69.11Z"/>
    <path d="M12 72.5H80L114 13.61 46 13.61Z"/>
    <path d="M12 128V72.5M80 128V72.5M114 69.11V13.61"/>
    <path d="M46 69.11V13.61M114 69.11H46L12 128" opacity=".45"/>
  </g>
  <g class="cd-corner">
    <circle cx="12" cy="128" r="3.4"/><circle cx="80" cy="128" r="3.4"/><circle cx="114" cy="69.11" r="3.4"/><circle cx="46" cy="69.11" r="3.4"/>
    <circle cx="12" cy="72.5" r="3.4"/><circle cx="80" cy="72.5" r="3.4"/><circle cx="114" cy="13.61" r="3.4"/><circle cx="46" cy="13.61" r="3.4"/>
  </g>
  <circle class="cd-body" cx="57.3" cy="61" r="6"/>

  <g class="cd-line">
    <path d="M236 49 219.5 63.3H186.5L170 49 186.5 34.7H219.5Z"/>
    <path d="M236 103 219.5 117.3H186.5L170 103 186.5 88.7H219.5Z"/>
    <path d="M236 49V103M219.5 63.3V117.3M186.5 63.3V117.3M170 49V103M186.5 34.7V88.7M219.5 34.7V88.7"/>
  </g>
  <g class="cd-corner">
    <circle cx="236" cy="49" r="3.4"/><circle cx="219.5" cy="63.3" r="3.4"/><circle cx="186.5" cy="63.3" r="3.4"/>
    <circle cx="170" cy="49" r="3.4"/><circle cx="186.5" cy="34.7" r="3.4"/><circle cx="219.5" cy="34.7" r="3.4"/>
    <circle cx="236" cy="103" r="3.4"/><circle cx="219.5" cy="117.3" r="3.4"/><circle cx="186.5" cy="117.3" r="3.4"/>
    <circle cx="170" cy="103" r="3.4"/><circle cx="186.5" cy="88.7" r="3.4"/><circle cx="219.5" cy="88.7" r="3.4"/>
  </g>
  <g class="cd-face">
    <circle cx="203" cy="49" r="4.6"/>
    <circle cx="203" cy="66.5" r="4.6"/><circle cx="186.5" cy="80.8" r="4.6"/><circle cx="219.5" cy="80.8" r="4.6"/>
    <g opacity=".45"><circle cx="203" cy="103" r="4.6"/></g>
  </g>

  <text class="cd-label" x="12" y="152">原胞 2 原子</text>
  <text class="cd-sub" x="12" y="166">A + B 基元</text>
  <text class="cd-label" x="136" y="152">六方棱柱 6 原子</text>
  <text class="cd-sub" x="136" y="166">12×1/6 + 2×1/2 + 3</text>
</svg>`;

export function cellDiagramSvg(id: StructureId): string {
  if (id === 'fcc') return FCC;
  if (id === 'bcc') return BCC;
  return HCP;
}
