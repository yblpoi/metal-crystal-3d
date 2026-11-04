import type { StructureId } from '../crystal/types';

const FCC = `
<svg viewBox="0 0 260 150" role="img" aria-label="FCC 惯用晶胞示意图">
  <g class="cd-line">
    <path d="M52 48h124v84H52Z"/>
    <path d="M26 28h124v84H26Z"/>
    <path d="M52 48 26 28M176 48l-26-20M176 132l-26-20M52 132l-26-20"/>
    <path d="M26 28 150 28M150 28v84M150 112H26M52 132h124" opacity=".45"/>
  </g>
  <g class="cd-face">
    <circle cx="114" cy="90" r="7"/><circle cx="163" cy="80" r="7"/><circle cx="101" cy="38" r="7"/>
    <circle cx="39" cy="80" r="5.5" opacity=".45"/><circle cx="101" cy="122" r="5.5" opacity=".45"/><circle cx="88" cy="70" r="5.5" opacity=".45"/>
  </g>
  <g class="cd-corner">
    <circle cx="52" cy="48" r="5"/><circle cx="176" cy="48" r="5"/><circle cx="176" cy="132" r="5"/><circle cx="52" cy="132" r="5"/>
    <circle cx="26" cy="28" r="4"/><circle cx="150" cy="28" r="4"/><circle cx="150" cy="112" r="4"/><circle cx="26" cy="112" r="4"/>
  </g>
  <text class="cd-label" x="14" y="142">惯用胞 4 原子</text>
  <text class="cd-sub" x="130" y="142">8×1/8 + 6×1/2</text>
</svg>`;

const BCC = `
<svg viewBox="0 0 260 150" role="img" aria-label="BCC 惯用晶胞示意图">
  <g class="cd-line">
    <path d="M52 48h124v84H52Z"/>
    <path d="M26 28h124v84H26Z"/>
    <path d="M52 48 26 28M176 48l-26-20M176 132l-26-20M52 132l-26-20"/>
    <path d="M26 28 150 28M150 28v84M150 112H26M52 132h124" opacity=".45"/>
  </g>
  <g class="cd-corner">
    <circle cx="52" cy="48" r="5"/><circle cx="176" cy="48" r="5"/><circle cx="176" cy="132" r="5"/><circle cx="52" cy="132" r="5"/>
    <circle cx="26" cy="28" r="4"/><circle cx="150" cy="28" r="4"/><circle cx="150" cy="112" r="4"/><circle cx="26" cy="112" r="4"/>
  </g>
  <circle class="cd-body" cx="101" cy="80" r="11"/>
  <text class="cd-label" x="14" y="142">惯用胞 2 原子</text>
  <text class="cd-sub" x="130" y="142">8×1/8 + 1 体心</text>
</svg>`;

const HCP = `
<svg viewBox="0 0 260 150" role="img" aria-label="HCP 原胞与六方棱柱示意图">
  <g class="cd-line">
    <path d="M18 112 52 44h58l-34 68Z"/>
    <path d="M52 44v68M18 112h58" opacity=".4"/>
  </g>
  <g class="cd-corner">
    <circle cx="18" cy="112" r="4.5"/><circle cx="52" cy="44" r="4.5"/><circle cx="110" cy="44" r="4.5"/><circle cx="76" cy="112" r="4.5"/>
  </g>
  <circle class="cd-body" cx="63" cy="78" r="5.5"/>
  <text class="cd-label" x="10" y="140">原胞 2 原子</text>
  <text class="cd-sub" x="10" y="128">A + B 基元</text>

  <g class="cd-line">
    <path d="M160 66l22-12 22 12v34l-22 12-22-12Z"/>
    <path d="M160 78l22-12 22 12M160 92l22-12 22 12M160 106l22-12 22 12" opacity=".45"/>
    <path d="M160 66v40M182 54v40M204 66v40" opacity=".45"/>
    <path d="M160 78v34M182 66v34M204 78v34" opacity=".3"/>
  </g>
  <g class="cd-corner">
    <circle cx="160" cy="66" r="3.4"/><circle cx="182" cy="54" r="3.4"/><circle cx="204" cy="66" r="3.4"/>
    <circle cx="160" cy="106" r="3.4"/><circle cx="182" cy="118" r="3.4"/><circle cx="204" cy="106" r="3.4"/>
  </g>
  <g class="cd-face">
    <circle cx="182" cy="66" r="4.2"/><circle cx="182" cy="106" r="4.2"/>
    <circle cx="171" cy="86" r="3.6"/><circle cx="182" cy="74" r="3.6"/><circle cx="193" cy="86" r="3.6"/>
  </g>
  <text class="cd-label" x="152" y="140">六方棱柱 6 原子</text>
  <text class="cd-sub" x="152" y="128">12×1/6 + 2×1/2 + 3</text>
</svg>`;

export function cellDiagramSvg(id: StructureId): string {
  if (id === 'fcc') return FCC;
  if (id === 'bcc') return BCC;
  return HCP;
}
